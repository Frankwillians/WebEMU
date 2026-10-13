/**
 * ROMLoader - Painel 1: Carregamento manual de ROMs do computador
 * Suporta Drag & Drop e seleção via input file.
 */

import { useCallback, useRef, useState } from 'react';
import { useStore } from '../store';

interface ROMLoaderProps {
  onLoadROM: (file: File) => Promise<void>;
  onLoadBIOS: (file: File) => Promise<void>;
  disabled?: boolean;
}

const SUPPORTED_EXTENSIONS = ['.bin', '.iso', '.cue', '.img', '.mdf', '.pbp', '.exe'];

export function ROMLoader({ onLoadROM, onLoadBIOS, disabled }: ROMLoaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const biosInputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useStore();

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const validateFile = (file: File): boolean => {
    const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      addToast('error', `Formato não suportado: ${ext}. Use ${SUPPORTED_EXTENSIONS.join(', ')}`);
      return false;
    }
    return true;
  };

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    // Detecta se é uma BIOS (geralmente .bin de 512KB)
    for (const file of files) {
      const lowerName = file.name.toLowerCase();
      const isBios = lowerName.includes('bios') || lowerName.startsWith('scph');
      if (isBios) {
        await onLoadBIOS(file);
      } else if (validateFile(file)) {
        await onLoadROM(file);
      }
    }
  }, [disabled, onLoadROM, onLoadBIOS, addToast]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && validateFile(file)) {
      await onLoadROM(file);
    }
    // Reset para permitir selecionar o mesmo arquivo novamente
    e.target.value = '';
  }, [onLoadROM, addToast]);

  const handleBIOSSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onLoadBIOS(file);
    }
    e.target.value = '';
  }, [onLoadBIOS]);

  return (
    <div className="rom-loader">
      <div
        className={`drop-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        aria-label="Carregar ROM por drag and drop ou clique"
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        <div className="drop-zone-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <h3>Arraste sua ROM aqui</h3>
        <p>ou clique para selecionar</p>
        <div className="drop-zone-formats">
          {SUPPORTED_EXTENSIONS.map(ext => (
            <span key={ext} className="badge badge-info">{ext}</span>
          ))}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={SUPPORTED_EXTENSIONS.join(',')}
        onChange={handleFileSelect}
        style={{ display: 'none' }}
        aria-hidden="true"
      />

      <div className="bios-loader">
        <div className="bios-loader-info">
          <span className="bios-loader-title">BIOS do PS1</span>
          <span className="bios-loader-hint">Necessária para o boot (scph1001.bin, etc)</span>
        </div>
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => biosInputRef.current?.click()}
          disabled={disabled}
        >
          Carregar BIOS
        </button>
        <input
          ref={biosInputRef}
          type="file"
          accept=".bin"
          onChange={handleBIOSSelect}
          style={{ display: 'none' }}
          aria-hidden="true"
        />
      </div>

      <style>{`
        .rom-loader { display: flex; flex-direction: column; gap: var(--space-md); }

        .drop-zone {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: var(--space-sm);
          padding: var(--space-xl);
          border: 2px dashed var(--border-color);
          border-radius: var(--radius-lg);
          background: var(--bg-secondary);
          cursor: pointer;
          transition: all var(--transition-normal);
          min-height: 220px;
          text-align: center;
        }

        .drop-zone:hover:not(.disabled) {
          border-color: var(--accent-primary);
          background: var(--bg-tertiary);
        }

        .drop-zone.dragging {
          border-color: var(--accent-primary);
          background: rgba(0, 217, 255, 0.05);
          box-shadow: var(--shadow-glow);
          transform: scale(1.01);
        }

        .drop-zone.disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .drop-zone-icon {
          color: var(--accent-primary);
          margin-bottom: var(--space-sm);
        }

        .drop-zone h3 {
          font-size: 18px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .drop-zone p {
          font-size: 14px;
          color: var(--text-secondary);
        }

        .drop-zone-formats {
          display: flex;
          flex-wrap: wrap;
          gap: var(--space-xs);
          justify-content: center;
          margin-top: var(--space-sm);
        }

        .bios-loader {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-md);
          padding: var(--space-md);
          background: var(--bg-card);
          border: 1px solid var(--border-color);
          border-radius: var(--radius-md);
        }

        .bios-loader-info {
          display: flex;
          flex-direction: column;
        }

        .bios-loader-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-primary);
        }

        .bios-loader-hint {
          font-size: 12px;
          color: var(--text-muted);
        }
      `}</style>
    </div>
  );
}

export default ROMLoader;