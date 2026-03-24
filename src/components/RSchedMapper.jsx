// src/components/RSchedMapper.jsx
import { useState, useMemo, useCallback, useRef } from 'react';
import { usePermissions } from '../hooks/usePermissions';
import { useLocationsQuery } from '../hooks/useLocationsQuery';
import { useBaseCategoriesQuery } from '../hooks/useCategoriesQuery';
import { useNotification } from '../context/NotificationContext';
import {
  parseRSchedCSV,
  buildLocationIndex,
  findBestLocationMatch,
  findBestCategoryMatch,
  buildMappedCSV,
} from '../utils/rschedMatchingUtils';
import './RSchedMapper.css';
import '../components/EventManagement.css';
import '../components/Admin.css';

export default function RSchedMapper({ apiToken }) {
  const { isAdmin } = usePermissions();
  const { showError } = useNotification();
  const fileInputRef = useRef(null);

  const { data: locations = [], isLoading: locationsLoading } = useLocationsQuery(apiToken);
  const { data: categories = [], isLoading: categoriesLoading } = useBaseCategoriesQuery(apiToken);

  // State
  const [step, setStep] = useState('upload'); // 'upload' | 'review'
  const [parsedData, setParsedData] = useState(null);
  const [fileName, setFileName] = useState('');
  const [locationMappings, setLocationMappings] = useState({});
  const [categoryMappings, setCategoryMappings] = useState({});
  const [activeTab, setActiveTab] = useState('locations');
  const [activeFilter, setActiveFilter] = useState('all');
  const [dragOver, setDragOver] = useState(false);

  // Precomputed location index
  const locationIndex = useMemo(
    () => buildLocationIndex(locations),
    [locations]
  );

  // Compute stats for location mappings
  const locationStats = useMemo(() => {
    const tokens = parsedData?.uniqueLocationTokens || [];
    const stats = { total: tokens.length, exact: 0, fuzzy: 0, unmatched: 0 };
    for (const t of tokens) {
      const m = locationMappings[t];
      if (!m) { stats.unmatched++; continue; }
      if (m.method === 'fuzzy') { stats.fuzzy++; }
      else { stats.exact++; } // exact, alias, manual all count as "exact"
    }
    return stats;
  }, [parsedData, locationMappings]);

  // Compute stats for category mappings
  const categoryStats = useMemo(() => {
    const tokens = parsedData?.uniqueCategoryTokens || [];
    const stats = { total: tokens.length, exact: 0, fuzzy: 0, unmatched: 0 };
    for (const t of tokens) {
      const m = categoryMappings[t];
      if (!m) { stats.unmatched++; continue; }
      if (m.method === 'fuzzy') { stats.fuzzy++; }
      else { stats.exact++; }
    }
    return stats;
  }, [parsedData, categoryMappings]);

  const currentStats = activeTab === 'locations' ? locationStats : categoryStats;
  const currentMappings = activeTab === 'locations' ? locationMappings : categoryMappings;
  const currentTokens = activeTab === 'locations'
    ? parsedData?.uniqueLocationTokens || []
    : parsedData?.uniqueCategoryTokens || [];

  // Filter tokens by active filter
  const filteredTokens = useMemo(() => {
    return currentTokens.filter(token => {
      if (activeFilter === 'all') return true;
      const m = currentMappings[token];
      if (activeFilter === 'unmatched') return !m;
      if (activeFilter === 'exact') return m && m.method !== 'fuzzy';
      if (activeFilter === 'fuzzy') return m && m.method === 'fuzzy';
      return true;
    });
  }, [currentTokens, currentMappings, activeFilter]);

  // Handle file processing
  const processFile = useCallback((file) => {
    if (!file || !file.name.endsWith('.csv')) {
      showError('Please upload a CSV file');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsed = parseRSchedCSV(text);

        if (parsed.rows.length === 0) {
          showError('CSV file contains no data rows');
          return;
        }

        if (parsed.uniqueLocationTokens.length === 0 && parsed.uniqueCategoryTokens.length === 0) {
          showError(`No location or category data found. Detected columns: ${parsed.headers.join(', ')}`);
          return;
        }

        // Auto-match locations
        const locMappings = {};
        for (const token of parsed.uniqueLocationTokens) {
          locMappings[token] = findBestLocationMatch(token, locationIndex);
        }

        // Auto-match categories
        const catMappings = {};
        for (const token of parsed.uniqueCategoryTokens) {
          catMappings[token] = findBestCategoryMatch(token, categories);
        }

        setParsedData(parsed);
        setFileName(file.name);
        setLocationMappings(locMappings);
        setCategoryMappings(catMappings);
        setStep('review');
        setActiveTab('locations');
        setActiveFilter('all');

      } catch (err) {
        showError('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  }, [locationIndex, categories, showError]);

  // Drag & drop handlers
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  }, [processFile]);

  const handleFileSelect = useCallback((e) => {
    const file = e.target.files[0];
    if (file) processFile(file);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }, [processFile]);

  // Override handlers
  const handleLocationOverride = useCallback((token, locationId) => {
    if (!locationId) {
      // Cleared override — re-run auto match
      setLocationMappings(prev => ({
        ...prev,
        [token]: findBestLocationMatch(token, locationIndex),
      }));
    } else {
      const loc = locations.find(l => String(l._id) === locationId);
      if (loc) {
        setLocationMappings(prev => ({
          ...prev,
          [token]: { location: loc, score: 1.0, method: 'manual' },
        }));
      }
    }
  }, [locations, locationIndex]);

  const handleCategoryOverride = useCallback((token, categoryId) => {
    if (!categoryId) {
      setCategoryMappings(prev => ({
        ...prev,
        [token]: findBestCategoryMatch(token, categories),
      }));
    } else {
      const cat = categories.find(c => String(c._id) === categoryId);
      if (cat) {
        setCategoryMappings(prev => ({
          ...prev,
          [token]: { category: cat, score: 1.0, method: 'manual' },
        }));
      }
    }
  }, [categories]);

  // Export
  const handleExport = useCallback(() => {
    if (!parsedData) return;
    const csv = buildMappedCSV(parsedData.headers, parsedData.rows, locationMappings, categoryMappings, parsedData.detectedColumns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rsched_mapped.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [parsedData, locationMappings, categoryMappings]);

  // Back to upload
  const handleBack = useCallback(() => {
    setStep('upload');
    setParsedData(null);
    setFileName('');
    setLocationMappings({});
    setCategoryMappings({});
    setActiveFilter('all');
  }, []);

  // Access denied
  if (!isAdmin) {
    return (
      <div className="em-access-denied">
        <div className="em-access-denied-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
          </svg>
        </div>
        <h2>Access Denied</h2>
        <p>You need admin privileges to access RSched Mapper.</p>
      </div>
    );
  }

  const dbLoading = locationsLoading || categoriesLoading;

  // Helper to get badge class from method
  const getBadgeClass = (match) => {
    if (!match) return 'unmatched';
    return match.method; // 'exact', 'alias', 'fuzzy', 'manual'
  };

  const getBadgeLabel = (match) => {
    if (!match) return 'archive';
    const pct = Math.round(match.score * 100);
    switch (match.method) {
      case 'exact': return 'exact';
      case 'alias': return 'exact';
      case 'fuzzy': return `close ${pct}%`;
      case 'manual': return 'manual';
      default: return `${pct}%`;
    }
  };

  const getIdentifier = (match) => {
    if (!match) return '-';
    if (match.location) return match.location.rsKey || '-';
    if (match.category) return match.category.name;
    return '-';
  };

  const getDisplayName = (match) => {
    if (!match) return '-';
    if (match.location) return match.location.name || '-';
    if (match.category) return match.category.name;
    return '-';
  };

  const filterLabels = { all: 'All', exact: 'Exact', fuzzy: 'Close', unmatched: 'Archive' };

  return (
    <div className="em-container">
      {step === 'upload' && (
        <>
          <div className="em-page-header">
            <h2>RSched Mapper</h2>
            <div className="em-page-header-subtitle">Map RSched CSV locations and categories to database entities</div>
          </div>

          <div className="rm-tbd-banner">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>This feature is under development and not yet functional. Check back soon.</span>
          </div>
        </>
      )}

      {step === 'review' && parsedData && (
        <>
          {/* Review header with actions */}
          <div className="rm-review-header">
            <div className="rm-review-header-left">
              <h2>Mapping Review</h2>
              <div className="em-page-header-subtitle">Verify matches, fix overrides, then export</div>
              <div className="rm-parse-summary">{parsedData.rows.length} rows parsed from {fileName}</div>
            </div>
            <div className="rm-review-header-right">
              <button className="rm-header-btn" onClick={handleBack}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back
              </button>
              <button className="rm-header-btn primary" onClick={handleExport}>
                Export CSV
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="em-tabs">
            <button
              className={`em-tab ${activeTab === 'locations' ? 'active' : ''}`}
              onClick={() => { setActiveTab('locations'); setActiveFilter('all'); }}
            >
              LOCATIONS ({locationStats.total})
            </button>
            <button
              className={`em-tab ${activeTab === 'categories' ? 'active' : ''}`}
              onClick={() => { setActiveTab('categories'); setActiveFilter('all'); }}
            >
              CATEGORIES ({categoryStats.total})
            </button>
          </div>

          {/* Compact stats */}
          <div className="rm-compact-stats">
            <div className="rm-stat-item">
              <span className="rm-stat-number total">{currentStats.total}</span>
              <span className="rm-stat-label">TOTAL</span>
            </div>
            <div className="rm-stat-item">
              <span className="rm-stat-number exact">{currentStats.exact}</span>
              <span className="rm-stat-label">EXACT</span>
            </div>
            <div className="rm-stat-item">
              <span className="rm-stat-number fuzzy">{currentStats.fuzzy}</span>
              <span className="rm-stat-label">CLOSE</span>
            </div>
            <div className="rm-stat-item">
              <span className="rm-stat-number unmatched">{currentStats.unmatched}</span>
              <span className="rm-stat-label">ARCHIVE</span>
            </div>
          </div>

          {/* Filter bar */}
          <div className="rm-filter-bar">
            {['all', 'exact', 'fuzzy', 'unmatched'].map(filter => {
              const count = filter === 'all' ? currentStats.total : currentStats[filter];
              return (
                <button
                  key={filter}
                  className={`rm-filter-btn ${activeFilter === filter ? 'active' : ''}`}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filterLabels[filter]}
                  <span className="rm-filter-count">{count}</span>
                </button>
              );
            })}
          </div>

          {/* Match table */}
          <div className="admin-table-container">
            <table className="admin-table rm-match-table">
              <thead>
                <tr>
                  <th>CSV TOKEN</th>
                  <th>CONFIDENCE</th>
                  <th>{'\u2192 IDENTIFIER'}</th>
                  <th>{'\u2192 DISPLAY NAME'}</th>
                  <th>OVERRIDE</th>
                </tr>
              </thead>
              <tbody>
                {filteredTokens.map(token => {
                  const match = currentMappings[token];
                  const rowClass = !match ? 'rm-row-unmatched' : match.method === 'fuzzy' ? 'rm-row-fuzzy' : '';

                  return (
                    <tr key={token} className={rowClass}>
                      <td title={token}>{token}</td>
                      <td>
                        <span className={`rm-badge ${getBadgeClass(match)}`}>
                          {getBadgeLabel(match)}
                        </span>
                      </td>
                      <td><span className="rm-identifier">{getIdentifier(match)}</span></td>
                      <td title={getDisplayName(match)}>{getDisplayName(match)}</td>
                      <td>
                        {activeTab === 'locations' ? (
                          <select
                            className="inline-edit-select"
                            value={match?.location ? String(match.location._id) : ''}
                            onChange={(e) => handleLocationOverride(token, e.target.value)}
                          >
                            <option value="">-- Select location --</option>
                            {locations.map(loc => (
                              <option key={String(loc._id)} value={String(loc._id)}>
                                {loc.name}{loc.rsKey ? ` [${loc.rsKey}]` : ''}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <select
                            className="inline-edit-select"
                            value={match?.category ? String(match.category._id) : ''}
                            onChange={(e) => handleCategoryOverride(token, e.target.value)}
                          >
                            <option value="">-- Select category --</option>
                            {categories.map(cat => (
                              <option key={String(cat._id)} value={String(cat._id)}>
                                {cat.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {filteredTokens.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--text-tertiary)' }}>
                      No tokens match this filter
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
