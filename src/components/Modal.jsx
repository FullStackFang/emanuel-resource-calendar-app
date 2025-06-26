// src/components/Modal.jsx
import React from 'react';

function Modal({ isOpen, onClose, title, children, hideTitle = false }) {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          {!hideTitle && <h3>{title}</h3>}
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-content">
          {children}
        </div>
      </div>
    </div>
  );
}

export default Modal;