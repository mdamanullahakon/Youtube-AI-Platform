// src/hooks/useAnalytics.jsx
import { useState, useEffect } from 'react';

/**
 * Fetch analytics data for a given project.
 * Returns { data, loading, error }.
 * For now the projectId is hard‑coded (or can be passed).
 */
export default function useAnalytics(projectId = 'demo') {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      try {
        const res = await fetch(`/api/analytics/${projectId}`);
        if (!res.ok) throw new Error('Network response was not ok');
        const json = await res.json();
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return { data, loading, error };
}
