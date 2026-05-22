'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore, apiClient } from '@/store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import type { YouTubeChannel } from '@/lib/types';

export default function SettingsPage() {
  const router = useRouter();
  const { user, token } = useAuthStore();
  const queryClient = useQueryClient();
  const [apiKeys, setApiKeys] = useState({
    geminiKey: '',
    youtubeApiKey: '',
  });
  const [connecting, setConnecting] = useState(false);

  const { data: profileData } = useQuery({
    queryKey: ['profile'],
    queryFn: () => apiClient('/api/auth/profile'),
    staleTime: 5 * 60 * 1000,
    enabled: !!token,
    retry: false,
  });

  const { data: keysData, isLoading: keysLoading } = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient('/api/keys'),
    staleTime: 5 * 60 * 1000,
    enabled: !!token,
    retry: false,
  });

  useEffect(() => {
    if (keysData?.success && keysData?.data) {
      queueMicrotask(() => {
        setApiKeys({
          geminiKey: keysData.data.geminiKey || '',
          youtubeApiKey: keysData.data.youtubeApiKey || '',
        });
      });
    }
  }, [keysData]);

  const { data: channelsData, refetch: refetchChannels } = useQuery({
    queryKey: ['youtube-channels'],
    queryFn: () => apiClient('/api/auth/youtube/channels'),
    staleTime: 5 * 60 * 1000,
    enabled: !!token,
    retry: false,
  });

  const channels: (YouTubeChannel & { isActive?: boolean })[] = channelsData?.channels || [];

  const { data: activeChannelData, refetch: refetchActive } = useQuery({
    queryKey: ['youtube-active'],
    queryFn: () => apiClient('/api/auth/youtube/active'),
    staleTime: 5 * 60 * 1000,
    enabled: !!token,
    retry: false,
  });

  const { data: fallbackData, refetch: refetchFallback } = useQuery({
    queryKey: ['youtube-fallback'],
    queryFn: () => apiClient('/api/upload/fallback/status'),
    staleTime: 30 * 1000,
    enabled: !!token,
    retry: false,
  });

  const fallback = fallbackData?.data;
  const isFallbackActive = fallback?.active;

  const { data: fallbackQueueData, refetch: refetchQueue } = useQuery({
    queryKey: ['youtube-fallback-queue'],
    queryFn: () => apiClient('/api/upload/fallback/queue'),
    staleTime: 30 * 1000,
    enabled: !!token && !!isFallbackActive,
    retry: false,
  });

  const fallbackQueue = fallbackQueueData?.data || [];

  const exportMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiClient(`/api/upload/fallback/export/${projectId}`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data.success) { toast.success('Video package exported'); refetchQueue(); }
      else { toast.error(data.message || 'Export failed'); }
    },
  });

  const retryMutation = useMutation({
    mutationFn: (projectId: string) =>
      apiClient(`/api/upload/fallback/retry/${projectId}`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data.success) { toast.success('Retry scheduled'); refetchQueue(); }
      else { toast.error(data.message || 'Retry failed'); }
    },
  });

  const retryAllMutation = useMutation({
    mutationFn: () => apiClient('/api/upload/fallback/retry-all', { method: 'POST' }),
    onSuccess: (data) => {
      if (data.success) { toast.success('All queued uploads retrying'); refetchQueue(); }
      else { toast.error(data.message || 'Retry all failed'); }
    },
  });

  const saveKeysMutation = useMutation({
    mutationFn: () => apiClient('/api/keys/save', {
      method: 'POST',
      body: JSON.stringify(apiKeys),
    }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('API keys saved successfully!');
      } else {
        toast.error(data.message || 'Failed to save API keys');
      }
    },
  });

  const handleSaveKeys = (e: React.FormEvent) => {
    e.preventDefault();
    saveKeysMutation.mutate();
  };

  const { data: oauthStatus } = useQuery({
    queryKey: ['youtube-oauth-status'],
    queryFn: () => apiClient('/api/auth/youtube/status'),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const { data: reconnectData, refetch: refetchReconnect } = useQuery({
    queryKey: ['youtube-reconnect-needed'],
    queryFn: () => apiClient('/api/auth/youtube/reconnect-needed'),
    staleTime: 5 * 60 * 1000,
    enabled: !!token,
    retry: false,
  });

  const reconnectNeededChannels: (YouTubeChannel & { createdAt: string })[] = reconnectData?.channels || [];

  const setActiveMutation = useMutation({
    mutationFn: (accountId: string) =>
      apiClient(`/api/auth/youtube/active/${accountId}`, { method: 'PUT' }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('Active channel updated');
        refetchChannels();
        refetchActive();
        queryClient.invalidateQueries({ queryKey: ['youtube-channels'] });
        queryClient.invalidateQueries({ queryKey: ['youtube-active'] });
      } else {
        toast.error(data.message || 'Failed to set active channel');
      }
    },
  });

  const connectYouTube = useCallback(async () => {
    if (connecting) return;
    if (oauthStatus?.data && !oauthStatus.data.clientIdConfigured) {
      toast.error('YouTube OAuth is not configured. Go to Setup Wizard to add your Client ID and Secret first.');
      router.push('/setup');
      return;
    }
    setConnecting(true);
    try {
      const data = await apiClient('/api/auth/youtube/connect');
      if (data.success && data.authUrl) {
        window.location.href = data.authUrl;
      } else if (data.code === 'DELETED_CLIENT') {
        toast.error('YouTube OAuth client was DELETED from Google Cloud Console. Create new credentials at console.cloud.google.com/apis/credentials, update .env, then restart the server.', { duration: 10000 });
        window.open('https://console.cloud.google.com/apis/credentials', '_blank', 'noopener,noreferrer');
      } else if (data.code === 'OAUTH_NOT_CONFIGURED') {
        toast.error('YouTube OAuth credentials missing. Please configure them in Settings or .env');
        router.push('/setup');
      } else if (data.code === 'OAUTH_CONFIG_ERROR' && data.errors?.length > 0) {
        toast.error(data.errors[0].split('\n')[0]);
        router.push('/setup');
      } else {
        const errMsg = data.message || 'Failed to get YouTube auth URL';
        if (data.code === 'NETWORK_ERROR' || errMsg.includes('Failed to fetch') || errMsg.includes('load failed')) {
          toast.error(`Cannot reach API server. Check that the backend is running on port 4000.`, { duration: 5000 });
        } else {
          toast.error(errMsg);
        }
      }
    } catch {
      toast.error('Connection failed. Check if the API server is running.');
    } finally {
      setConnecting(false);
    }
  }, [connecting, oauthStatus, router]);

  const handleDisconnect = useMutation({
    mutationFn: (accountId: string) =>
      apiClient(`/api/auth/youtube/disconnect/${accountId}`, { method: 'POST' }),
    onSuccess: (data) => {
      if (data.success) {
        toast.success('YouTube channel disconnected');
        refetchChannels();
        refetchActive();
      } else {
        toast.error(data.message || 'Failed to disconnect');
      }
    },
  });

  const handleRefreshAll = useMutation({
    mutationFn: () => apiClient('/api/auth/youtube/refresh-all', { method: 'POST' }),
    onSuccess: (data) => {
      if (data.success) {
        const count = data.results?.filter((r: { status: string }) => r.status === 'refreshed').length || 0;
        toast.success(`Refreshed ${count} channel(s)`);
      } else {
        toast.error(data.message || 'Failed to refresh tokens');
      }
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const youtube = params.get('youtube');
    if (youtube === 'connected') {
      toast.success(`YouTube channel connected!`);
      refetchChannels();
      refetchActive();
      refetchReconnect();
      window.history.replaceState({}, '', '/dashboard/settings');
    } else if (youtube === 'error') {
      toast.error(`YouTube connection failed: ${params.get('reason') || 'Unknown error'}`);
      window.history.replaceState({}, '', '/dashboard/settings');
    }
  }, [refetchChannels, refetchActive, refetchReconnect]);

  const refreshFallbackChannels = useCallback(() => {
    refetchFallback();
    refetchQueue();
  }, [refetchFallback, refetchQueue]);

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted mt-1">Configure your AI platform</p>
      </div>

      <div className="glow-card rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">Profile</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-muted mb-1">Email</label>
            <p className="text-sm">{user?.email}</p>
          </div>
          <div>
            <label className="block text-sm text-muted mb-1">Plan</label>
            <p className="text-sm">{profileData?.user?.subscription?.plan || 'Free'} - {profileData?.user?.subscription?.status || 'Active'}</p>
          </div>
        </div>
      </div>

      {reconnectNeededChannels.length > 0 && (
        <div className="rounded-xl p-6 bg-red-950/20 border border-red-500/30">
          <div className="flex items-start gap-3">
            <div className="text-xl flex-shrink-0">!</div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-red-400">Reconnection Required</h2>
              <p className="text-sm text-muted mt-1">
                {reconnectNeededChannels.length} channel{reconnectNeededChannels.length > 1 ? 's' : ''} need{reconnectNeededChannels.length === 1 ? 's' : ''} to be reconnected.
                Google revoked the authorization — click &quot;Connect YouTube Channel&quot; below to re-authenticate.
              </p>
              <div className="mt-3 space-y-2">
                {reconnectNeededChannels.slice(0, 3).map((ch) => (
                  <div key={ch.id} className="flex items-center gap-3 p-2 bg-background/50 rounded-lg">
                    {ch.channelAvatar ? (
                      <img src={ch.channelAvatar} alt="" className="w-8 h-8 rounded-full" />
                    ) : (
                      <div className="w-8 h-8 rounded-full bg-red-500/20 flex items-center justify-center text-sm">TV</div>
                    )}
                    <div>
                      <p className="text-sm font-medium">{ch.channelTitle || 'YouTube Channel'}</p>
                      <p className="text-xs text-muted">Disconnected {ch.createdAt ? new Date(ch.createdAt).toLocaleDateString() : ''}</p>
                    </div>
                  </div>
                ))}
                {reconnectNeededChannels.length > 3 && (
                  <p className="text-xs text-muted">+{reconnectNeededChannels.length - 3} more</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="glow-card rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">YouTube Channels</h2>
          {channels.length > 0 && (
            <button
              onClick={() => handleRefreshAll.mutate()}
              disabled={handleRefreshAll.isPending}
              className="text-xs px-3 py-1 rounded bg-background border border-muted/30 hover:border-primary/50 disabled:opacity-50"
            >
              {handleRefreshAll.isPending ? 'Refreshing...' : 'Refresh All Tokens'}
            </button>
          )}
        </div>
        {channels.length === 0 ? (
          <div className="text-center py-6">
            <p className="text-muted mb-4">No YouTube channels connected yet.</p>
            <button onClick={connectYouTube} disabled={connecting} className="btn-primary">
              {connecting ? 'Connecting...' : 'Connect YouTube Channel'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {channels.map((channel) => {
              const isActive = channel.isActive || activeChannelData?.channel?.id === channel.id;
              return (
                <div
                  key={channel.id}
                  className={`flex items-center justify-between p-3 rounded-xl border ${isActive ? 'bg-primary/5 border-primary/30' : 'bg-background border-transparent'}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {channel.channelAvatar ? (
                      <img src={channel.channelAvatar} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-lg flex-shrink-0">
                        <span role="img" aria-label="TV">📺</span>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{channel.channelTitle || 'YouTube Channel'}</p>
                        {isActive && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium flex-shrink-0">ACTIVE</span>
                        )}
                      </div>
                      <p className="text-xs text-muted">Connected {new Date(channel.createdAt).toLocaleDateString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!isActive && (
                      <button
                        onClick={() => setActiveMutation.mutate(channel.id)}
                        disabled={setActiveMutation.isPending}
                        className="text-xs px-2 py-1 rounded bg-background border border-muted/30 hover:border-primary/50 disabled:opacity-50"
                        title="Set as active channel"
                      >
                        Set Active
                      </button>
                    )}
                    <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-green-500' : 'bg-gray-500'}`} title={isActive ? 'Active' : 'Connected'} />
                    <button
                      onClick={() => handleDisconnect.mutate(channel.id)}
                      className="text-sm text-accent hover:underline disabled:opacity-50"
                      disabled={handleDisconnect.isPending}
                    >
                      Disconnect
                    </button>
                  </div>
                </div>
              );
            })}
            <button onClick={connectYouTube} disabled={connecting} className="btn-secondary w-full mt-2">
              {connecting ? 'Connecting...' : 'Connect Another Channel'}
            </button>
          </div>
        )}
      </div>

      {isFallbackActive && (
        <div className="rounded-xl p-6 space-y-4 bg-amber-950/20 border border-amber-500/30">
          <div className="flex items-start gap-3">
            <div className="text-2xl flex-shrink-0"><span role="img" aria-label="Warning">⚠️</span></div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-amber-300">Fallback Mode Active</h2>
              <p className="text-sm text-muted mt-1">
                YouTube connection issue detected. The system continues to generate content
                normally &mdash; videos are queued for upload once YouTube is reconnected.
              </p>
              <p className="text-xs text-muted mt-1">
                {fallback?.reason && <span>Reason: {fallback.reason}</span>}
                {fallback?.queuedCount > 0 && <span> &middot; {fallback.queuedCount} videos queued</span>}
              </p>
            </div>
          </div>

          {fallbackQueue.length > 0 && (
            <div className="space-y-2 mt-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Queued Uploads</h3>
                <button
                  onClick={() => retryAllMutation.mutate()}
                  disabled={retryAllMutation.isPending}
                  className="text-xs text-amber-400 hover:text-amber-300 disabled:opacity-50"
                >
                  {retryAllMutation.isPending ? 'Retrying...' : 'Retry All'}
                </button>
              </div>
              {fallbackQueue.slice(0, 5).map((item: { id: string; projectId: string; project?: { title?: string }; title?: string; createdAt: string }) => (
                <div key={item.id} className="flex items-center justify-between p-2 bg-background/50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.project?.title || item.title || 'Untitled'}</p>
                    <p className="text-xs text-muted">Queued {new Date(item.createdAt).toLocaleDateString()}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <button
                      onClick={() => exportMutation.mutate(item.projectId)}
                      disabled={exportMutation.isPending}
                      className="text-xs px-2 py-1 rounded bg-background border border-muted/30 hover:border-amber-400/50 disabled:opacity-50"
                    >
                      Export
                    </button>
                    <button
                      onClick={() => retryMutation.mutate(item.projectId)}
                      disabled={retryMutation.isPending}
                      className="text-xs px-2 py-1 rounded bg-background border border-muted/30 hover:border-amber-400/50 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  </div>
                </div>
              ))}
              {fallbackQueue.length > 5 && (
                <p className="text-xs text-muted text-center">
                  +{fallbackQueue.length - 5} more queued videos
                </p>
              )}
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <button
              onClick={refreshFallbackChannels}
              className="text-xs px-3 py-1.5 rounded bg-background border border-muted/30 hover:border-amber-400/50"
            >
              Refresh Status
            </button>
            {!oauthStatus?.data?.clientIdConfigured && (
              <button
                onClick={() => router.push('/setup')}
                className="text-xs px-3 py-1.5 rounded bg-amber-600/20 text-amber-400 border border-amber-500/30 hover:bg-amber-600/30"
              >
                Fix OAuth Config
              </button>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSaveKeys} className="glow-card rounded-xl p-6 space-y-4">
        <h2 className="text-lg font-semibold mb-4">API Keys</h2>

        <div>
          <label className="block text-sm font-medium mb-2">Gemini API Key (fallback)</label>
          <input
            type="password"
            value={apiKeys.geminiKey}
            onChange={(e) => setApiKeys({ ...apiKeys, geminiKey: e.target.value })}
            className="input-field"
            placeholder={keysLoading ? 'Loading...' : 'AIza...'}
            disabled={keysLoading}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">YouTube API Key</label>
          <input
            type="password"
            value={apiKeys.youtubeApiKey}
            onChange={(e) => setApiKeys({ ...apiKeys, youtubeApiKey: e.target.value })}
            className="input-field"
            placeholder={keysLoading ? 'Loading...' : 'Your YouTube API key'}
            disabled={keysLoading}
          />
        </div>

        <button type="submit" disabled={saveKeysMutation.isPending || keysLoading} className="btn-primary">
          {saveKeysMutation.isPending ? 'Saving...' : 'Save API Keys'}
        </button>
      </form>

      <div className="glow-card rounded-xl p-6">
        <h2 className="text-lg font-semibold mb-4">AI Model Selection</h2>
        <p className="text-sm text-muted">
          Default AI model: <strong>Ollama (LLaMA 3.2)</strong> &mdash; runs locally, zero cost.
          Set a Gemini API key above for cloud fallback.
        </p>
      </div>
    </div>
  );
}
