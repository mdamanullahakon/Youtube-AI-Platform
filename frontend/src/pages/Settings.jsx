import React, { useState } from 'react';

export default function Settings() {
  const [encryptionKey, setEncryptionKey] = useState('');
  const [mockMode, setMockMode] = useState(false);

  const handleOAuth = () => {
    // In real app redirect to backend OAuth endpoint
    window.location.href = '/api/auth/youtube';
  };

  const handleSave = () => {
    // Save settings to backend or localStorage as needed
    console.log('Settings saved', { encryptionKey, mockMode });
    alert('Settings saved');
  };

  return (
    <div className="settings-page glass-card">
      <h2>Settings</h2>
      <section>
        <button onClick={handleOAuth} className="btn primary">
          Connect YouTube Channel
        </button>
      </section>
      <section>
        <label>
          Encryption Key (64‑hex chars):
          <input
            type="text"
            value={encryptionKey}
            onChange={e => setEncryptionKey(e.target.value)}
            placeholder="e.g. a1b2c3..."
          />
        </label>
      </section>
      <section>
        <label>
          <input
            type="checkbox"
            checked={mockMode}
            onChange={e => setMockMode(e.target.checked)}
          />
          Enable Mock Mode (use dummy data)
        </label>
      </section>
      <section>
        <button onClick={handleSave} className="btn secondary">
          Save Settings
        </button>
      </section>
    </div>
  );
}
