"use client";
import Modal from "./Modal";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  message?: string;
}

export default function ConfirmDialog({ open, onClose, onConfirm, message }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="¿Confirmar eliminación?" width="max-w-sm">
      <p className="text-sm text-gray-500 mb-4">{message ?? "Esta acción no se puede deshacer."}</p>
      <div className="flex gap-2 justify-end">
        <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancelar
        </button>
        <button
          onClick={() => { onConfirm(); onClose(); }}
          className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
        >
          Eliminar
        </button>
      </div>
    </Modal>
  );
}
