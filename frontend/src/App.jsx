// src/App.jsx
import React from 'react';
import { Routes, Route, Link, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import Settings from './pages/Settings.jsx';
import Gallery from './pages/Gallery.jsx';
import Profile from './pages/Profile.jsx';
import './styles/theme.css';
import './styles/dashboard.css';

export default function App() {
  return (
    <div className="app-container">
      <nav className="nav-bar">
        <ul>
          <li><Link to="/dashboard">Dashboard</Link></li>
          <li><Link to="/gallery">Gallery</Link></li>
          <li><Link to="/profile">Profile</Link></li>
          <li><Link to="/settings">Settings</Link></li>
        </ul>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Navigate replace to="/dashboard" />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
