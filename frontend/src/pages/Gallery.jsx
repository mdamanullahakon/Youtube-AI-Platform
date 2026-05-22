import React, { useEffect, useState } from 'react';
import GlassCard from '../components/GlassCard.jsx';
import './gallery.css';

export default function Gallery() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // For demo, use mocked data
    const mock = [
      { id: '1', title: 'Demo Video 1', thumb: '/assets/hero.png' },
      { id: '2', title: 'Demo Video 2', thumb: '/assets/hero.png' },
      { id: '3', title: 'Demo Video 3', thumb: '/assets/hero.png' },
    ];
    setVideos(mock);
    setLoading(false);
  }, []);

  if (loading) return <p>Loading gallery...</p>;

  return (
    <div className="gallery-page glass-card">
      <h2>Video Gallery</h2>
      <div className="gallery-grid">
        {videos.map(v => (
          <div key={v.id} className="gallery-item">
            <img src={v.thumb} alt={v.title} className="thumb" />
            <p>{v.title}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
