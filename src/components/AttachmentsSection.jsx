// src/components/AttachmentsSection.jsx
import React, { useState, useEffect } from 'react';
import { useNotification } from '../context/NotificationContext';
import APP_CONFIG from '../config/config';
import './AttachmentsSection.css';

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
        console.log('🔍 [AttachmentsSection] Upload Debug:', {
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
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType.startsWith('text/')) return '📝';
    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
    return '📎';
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
      <div className="attachments-section">
        <div className="attachments-placeholder">
          <div className="placeholder-icon">📎</div>
          <div className="placeholder-text">
            Save the {resourceType} first to enable file attachments
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="attachments-section">
      {/* Upload Area - only show if not read-only */}
      {!readOnly && (
        <div className="file-upload-section">
          {/* Drag and Drop Zone */}
          <div
            className={`file-drop-zone ${dragOver ? 'drag-over' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => document.getElementById(`file-input-${resourceId}`).click()}
          >
            <div className="drop-zone-content">
              <div className="drop-zone-icon">📁</div>
              <div className="drop-zone-text">
                <strong>Drop files here</strong> or <span className="link-text">browse</span>
              </div>
              <div className="drop-zone-hint">
                PNG, JPG, PDF, DOC, XLS, TXT (max 25MB each)
              </div>
            </div>
          </div>

          {/* Hidden File Input */}
          <input
            id={`file-input-${resourceId}`}
            type="file"
            multiple
            accept=".png,.jpg,.jpeg,.gif,.pdf,.doc,.docx,.xls,.xlsx,.txt,.md"
            onChange={(e) => handleFileSelect(e.target.files)}
            style={{ display: 'none' }}
          />

          {/* Uploading Files Progress */}
          {uploadingFiles.length > 0 && (
            <div className="uploading-files">
              {uploadingFiles.map((file, index) => (
                <div key={index} className="uploading-file">
                  <span>📤 Uploading {file.name}...</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Attachment List */}
      {attachments.length > 0 ? (
        <div className="attachments-list">
          <div className="attachments-header">
            <strong>Attached Files ({attachments.length})</strong>
          </div>
          {attachments.map((attachment) => (
            <div key={attachment.id} className="attachment-item">
              <div className="attachment-info">
                {isPreviewable(attachment.mimeType) ? (
                  <button
                    type="button"
                    className="file-icon clickable"
                    onClick={() => handlePreviewFile(attachment)}
                    title="Click to preview file"
                  >
                    {getFileIcon(attachment.mimeType)}
                  </button>
                ) : (
                  <span className="file-icon">{getFileIcon(attachment.mimeType)}</span>
                )}
                <div className="file-details">
                  <div className="file-name">{attachment.fileName}</div>
                  <div className="file-meta">
                    {formatFileSize(attachment.fileSize)} •
                    Uploaded {new Date(attachment.uploadedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="attachment-actions">
                <button
                  type="button"
                  className="download-button"
                  onClick={() => handleDownloadFile(attachment)}
                  title="Download file"
                >
                  ⬇️
                </button>
                {!readOnly && (
                  <>
                    {deletingAttachmentId === attachment.id ? (
                      // Show confirmation buttons
                      <>
                        <button
                          type="button"
                          className="cancel-delete-button"
                          onClick={() => setDeletingAttachmentId(null)}
                          title="Cancel"
                        >
                          ❌ Cancel
                        </button>
                        <button
                          type="button"
                          className="confirm-delete-button"
                          onClick={() => removeAttachment(attachment.id, attachment.fileName)}
                          title="Confirm delete"
                        >
                          ✓ Delete
                        </button>
                      </>
                    ) : (
                      // Show delete button
                      <button
                        type="button"
                        className="remove-button"
                        onClick={() => setDeletingAttachmentId(attachment.id)}
                        title="Remove file"
                      >
                        🗑️
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="attachments-empty">
          <div className="empty-icon">📎</div>
          <div className="empty-text">No attachments</div>
          {!readOnly && (
            <div className="empty-hint">Drop files above or click to browse</div>
          )}
        </div>
      )}

      {/* Preview Modal */}
      {showPreviewModal && previewFile && (
        <div className="preview-modal-overlay" onClick={closePreview}>
          <div className="preview-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="preview-modal-header">
              <h3>{previewFile.fileName}</h3>
              <button
                type="button"
                className="close-preview-button"
                onClick={closePreview}
              >
                ✕
              </button>
            </div>
            <div className="preview-modal-body">
              {previewFile.mimeType.startsWith('image/') ? (
                <img
                  src={previewFile.blobUrl}
                  alt={previewFile.fileName}
                  className="preview-image"
                />
              ) : previewFile.mimeType === 'application/pdf' ? (
                <iframe
                  src={previewFile.blobUrl}
                  className="preview-pdf"
                  title={previewFile.fileName}
                />
              ) : (
                <div className="preview-text">
                  <p>Preview not available for this file type.</p>
                  <p>
                    <button
                      type="button"
                      className="download-link"
                      onClick={() => handleDownloadFile(previewFile)}
                    >
                      Download {previewFile.fileName}
                    </button>
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
