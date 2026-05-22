import React from 'react';
import './GlassCard.css';

/**
 * Reusable glass‑morphism card component.
 * Props:
 *   children – content inside the card
 *   className – additional CSS classes (optional)
 */
export default function GlassCard({ children, className = '' }) {
  return (
    <div className={`glass-card ${className}`}>
      {children}
    </div>
  );
}
