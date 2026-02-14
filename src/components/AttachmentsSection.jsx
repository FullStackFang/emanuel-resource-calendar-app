// src/components/AttachmentsSection.jsx
import React, { useState, useEffect } from 'react';
import { useNotification } from '../context/NotificationContext';
import { logger } from '../utils/logger';
import APP_CONFIG from '../config/config';
import './AttachmentsSection.css';

/* =========================================================================
   SVG Icon Components — crisp at any size, no emoji rendering variance
   ========================================================================= */

const Icon = ({ children, size = 20, className = '', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`att-icon ${className}`}
    {...props}
  >
    {children}
  </svg>
);

const IconImage = (props) => (
  <Icon {...props}>
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </Icon>
);

const IconFileText = (props) => (
  <Icon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </Icon>
);

const IconFilePdf = (props) => (
  <Icon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <text x="8" y="18" fontSize="7" fontWeight="700" fill="currentColor" stroke="none" fontFamily="sans-serif">PDF</text>
  </Icon>
);

const IconFileSpreadsheet = (props) => (
  <Icon {...props}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
    <line x1="12" y1="11" x2="12" y2="19" />
  </Icon>
);

const IconPaperclip = (props) => (
  <Icon {...props}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Icon>
);

const IconUploadCloud = (props) => (
  <Icon {...props}>
    <polyline points="16 16 12 12 8 16" />
    <line x1="12" y1="12" x2="12" y2="21" />
    <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3" />
    <polyline points="16 16 12 12 8 16" />
  </Icon>
);

const IconDownload = (props) => (
  <Icon {...props}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </Icon>
);

const IconTrash = (props) => (
  <Icon {...props}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </Icon>
);

const IconX = (props) => (
  <Icon {...props}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </Icon>
);

const IconCheck = (props) => (
  <Icon {...props}>
    <polyline points="20 6 9 17 4 12" />
  </Icon>
);

const IconEye = (props) => (
  <Icon {...props}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

const IconLoader = (props) => (
  <Icon {...props} className={`att-icon att-icon-spin ${props.className || ''}`}>
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
    <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
    <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
    <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
  </Icon>
);

/**
 * Reusable Attachments Section Component
 * Supports both events and reservations with full CRUD functionality
 */
export default function AttachmentsSection({
  resourceId, // event.id or reservation._id
  resourceType = 'event', // 'event' or 'reservation'
  apiToken,
  readOnly = false
}) {
  const { showError, showWarning } = useNotification();
  const [attachments, setAttachments] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState(null);

  // Load attachments when component mounts or resourceId changes
  useEffect(() => {
    if (resourceId && apiToken) {
      loadAttachments();
    }
  }, [resourceId, apiToken]);

  const loadAttachments = async () => {
    if (!resourceId || !apiToken) return;

    try {
      const endpoint = resourceType === 'event'
        ? `/events/${resourceId}/attachments`
        : `/reservations/${resourceId}/attachments`;

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}${endpoint}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        setAttachments(data.attachments || []);
      }
    } catch (error) {
      console.error('Failed to load attachments:', error);
    }
  };

  const handleFileSelect = (files) => {
    const fileArray = Array.from(files);
    uploadFiles(fileArray);
  };

  const uploadFiles = async (files) => {
    if (!resourceId || !apiToken) {
      showWarning(`Please save the ${resourceType} first before uploading files`);
      return;
    }

    for (const file of files) {
      setUploadingFiles(prev => [...prev, { name: file.name, progress: 0 }]);

      try {
        const formData = new FormData();
        formData.append('file', file);

        const endpoint = resourceType === 'event'
          ? `/events/${resourceId}/attachments`
          : `/reservations/${resourceId}/attachments`;

        // Debug logging to verify correct URL construction
        logger.log('[AttachmentsSection] Upload Debug:', {
          'API_BASE_URL': APP_CONFIG.API_BASE_URL,
          'endpoint': endpoint,
          'fullURL': `${APP_CONFIG.API_BASE_URL}${endpoint}`,
          'resourceType': resourceType,
          'resourceId': resourceId
        });

        const response = await fetch(`${APP_CONFIG.API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiToken}`
          },
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          setAttachments(prev => [...prev, data.attachment]);
        } else {
          const errorData = await response.json();
          showError(new Error(errorData.error), { context: 'AttachmentsSection.uploadFiles', userMessage: `Failed to upload ${file.name}` });
        }
      } catch (error) {
        console.error('Upload error:', error);
        showError(error, { context: 'AttachmentsSection.uploadFiles', userMessage: `Failed to upload ${file.name}` });
      } finally {
        setUploadingFiles(prev => prev.filter(f => f.name !== file.name));
      }
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    handleFileSelect(files);
  };

  const removeAttachment = async (attachmentId, fileName) => {
    if (!apiToken) return;

    // Inline confirmation is handled in the UI, so no confirm() dialog needed
    setDeletingAttachmentId(null); // Reset confirmation state

    try {
      const endpoint = resourceType === 'event'
        ? `/events/${resourceId}/attachments/${attachmentId}`
        : `/reservations/${resourceId}/attachments/${attachmentId}`;

      const response = await fetch(`${APP_CONFIG.API_BASE_URL}${endpoint}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (response.ok) {
        setAttachments(prev => prev.filter(att => att.id !== attachmentId));
      } else {
        const errorData = await response.json();
        showError(new Error(errorData.error), { context: 'AttachmentsSection.deleteAttachment', userMessage: `Failed to delete ${fileName}` });
      }
    } catch (error) {
      console.error('Failed to delete attachment:', error);
      showError(error, { context: 'AttachmentsSection.deleteAttachment', userMessage: `Failed to delete ${fileName}` });
    }
  };

  const getFileIcon = (mimeType) => {
    if (mimeType.startsWith('image/')) return IconImage;
    if (mimeType === 'application/pdf') return IconFilePdf;
    if (mimeType.startsWith('text/')) return IconFileText;
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return IconFileSpreadsheet;
    return IconPaperclip;
  };

  const getFileTypeLabel = (mimeType) => {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('text/')) return 'text';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return 'spreadsheet';
    return 'file';
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const isPreviewable = (mimeType) => {
    return (
      mimeType.startsWith('image/') ||
      mimeType === 'application/pdf' ||
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown'
    );
  };

  const handlePreviewFile = async (attachment) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}${attachment.downloadUrl}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to load file: ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);

      setPreviewFile({ ...attachment, blobUrl });
      setShowPreviewModal(true);
    } catch (error) {
      console.error('Preview failed:', error);
      showError(error, { context: 'AttachmentsSection.handlePreview', userMessage: 'Failed to load file preview. Please try downloading the file instead.' });
    }
  };

  const closePreview = () => {
    if (previewFile?.blobUrl) {
      URL.revokeObjectURL(previewFile.blobUrl);
    }
    setShowPreviewModal(false);
    setPreviewFile(null);
  };

  const handleDownloadFile = async (attachment) => {
    try {
      const response = await fetch(`${APP_CONFIG.API_BASE_URL}${attachment.downloadUrl}`, {
        headers: {
          'Authorization': `Bearer ${apiToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = attachment.fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Download failed:', error);
      showError(error, { context: 'AttachmentsSection.handleDownload', userMessage: 'Failed to download file' });
    }
  };

  // If no resource ID yet, show a placeholder message
  if (!resourceId) {
    return (
      <div className="att-section">
        <div className="att-placeholder">
          <div className="att-placeholder-icon">
            <IconPaperclip size={32} />
          </div>
          <div className="att-placeholder-text">
            Save the {resourceType} first to enable file attachments
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="att-section">
      {/* Upload Area - only show if not read-only */}
      {!readOnly && (
        <div className="att-upload-section">
          <div
            className={`att-drop-zone ${dragOver ? 'att-drop-zone--active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById(`file-input-${resourceId}`).click()}
          >
            <div className="att-drop-zone-inner">
              <div className="att-drop-zone-icon">
                <IconUploadCloud size={28} />
              </div>
              <div className="att-drop-zone-label">
                <span className="att-drop-zone-primary">Drop files here</span> or <span className="att-drop-zone-link">browse</span>
              </div>
              <div className="att-drop-zone-hint">
                PNG, JPG, PDF, DOC, XLS, TXT &middot; max 25 MB each
              </div>
            </div>
          </div>

          <input
            id={`file-input-${resourceId}`}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md"
            onChange={(e) => handleFileSelect(e.target.files)}
            className="att-hidden-input"
          />

          {/* Uploading Files Progress */}
          {uploadingFiles.length > 0 && (
            <div className="att-uploading-list">
              {uploadingFiles.map((file, index) => (
                <div key={index} className="att-uploading-item">
                  <IconLoader size={16} />
                  <span className="att-uploading-name">{file.name}</span>
                  <div className="att-uploading-bar">
                    <div className="att-uploading-bar-fill" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Attachment List */}
      {attachments.length > 0 ? (
        <div className="att-list">
          <div className="att-list-header">
            <IconPaperclip size={14} />
            <span>Attached Files ({attachments.length})</span>
          </div>
          {attachments.map((attachment, index) => {
            const FileIcon = getFileIcon(attachment.mimeType);
            const fileType = getFileTypeLabel(attachment.mimeType);
            const canPreview = isPreviewable(attachment.mimeType);

            return (
              <div
                key={attachment.id}
                className="att-item"
                style={{ '--att-item-index': index }}
              >
                <div className="att-item-info">
                  <div className={`att-item-icon att-item-icon--${fileType}`}>
                    {canPreview ? (
                      <button
                        type="button"
                        className="att-item-icon-btn"
                        onClick={() => handlePreviewFile(attachment)}
                        title="Preview file"
                      >
                        <FileIcon size={20} />
                      </button>
                    ) : (
                      <FileIcon size={20} />
                    )}
                  </div>
                  <div className="att-item-details">
                    <div className="att-item-name" title={attachment.fileName}>
                      {attachment.fileName}
                    </div>
                    <div className="att-item-meta">
                      <span className="att-item-size">{formatFileSize(attachment.fileSize)}</span>
                      <span className="att-item-meta-dot">&middot;</span>
                      <span className="att-item-date">{new Date(attachment.uploadedAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="att-item-actions">
                  {canPreview && (
                    <button
                      type="button"
                      className="att-action-btn att-action-btn--preview"
                      onClick={() => handlePreviewFile(attachment)}
                      title="Preview"
                    >
                      <IconEye size={16} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="att-action-btn att-action-btn--download"
                    onClick={() => handleDownloadFile(attachment)}
                    title="Download"
                  >
                    <IconDownload size={16} />
                  </button>
                  {!readOnly && (
                    <>
                      {deletingAttachmentId === attachment.id ? (
                        <div className="att-delete-confirm">
                          <button
                            type="button"
                            className="att-action-btn att-action-btn--cancel"
                            onClick={() => setDeletingAttachmentId(null)}
                            title="Cancel"
                          >
                            <IconX size={14} />
                          </button>
                          <button
                            type="button"
                            className="att-action-btn att-action-btn--confirm-delete"
                            onClick={() => removeAttachment(attachment.id, attachment.fileName)}
                            title="Confirm delete"
                          >
                            <IconCheck size={14} />
                            <span>Delete</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="att-action-btn att-action-btn--delete"
                          onClick={() => setDeletingAttachmentId(attachment.id)}
                          title="Remove file"
                        >
                          <IconTrash size={16} />
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="att-empty">
          <div className="att-empty-icon">
            <IconPaperclip size={32} />
          </div>
          <div className="att-empty-text">No attachments yet</div>
          {!readOnly && (
            <div className="att-empty-hint">Drop files above or click to browse</div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewFile && (
        <div className="att-preview-overlay" onClick={closePreview}>
          <div className="att-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="att-preview-header">
              <div className="att-preview-title-group">
                {(() => {
                  const PreviewIcon = getFileIcon(previewFile.mimeType);
                  return <PreviewIcon size={18} />;
                })()}
                <h3>{previewFile.fileName}</h3>
              </div>
              <div className="att-preview-header-actions">
                <button
                  type="button"
                  className="att-action-btn att-action-btn--download"
                  onClick={() => handleDownloadFile(previewFile)}
                  title="Download"
                >
                  <IconDownload size={16} />
                </button>
                <button
                  type="button"
                  className="att-preview-close"
                  onClick={closePreview}
                >
                  <IconX size={20} />
                </button>
              </div>
            </div>
            <div className="att-preview-body">
              {previewFile.mimeType.startsWith('image/') ? (
                <img
                  src={previewFile.blobUrl}
                  alt={previewFile.fileName}
                  className="att-preview-image"
                />
              ) : previewFile.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewFile.blobUrl}
                  className="att-preview-pdf"
                  title={previewFile.fileName}
                />
              ) : (
                <div className="att-preview-fallback">
                  <IconPaperclip size={48} />
                  <p>Preview not available for this file type.</p>
                  <button
                    type="button"
                    className="att-preview-download-btn"
                    onClick={() => handleDownloadFile(previewFile)}
                  >
                    <IconDownload size={16} />
                    Download {previewFile.fileName}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
