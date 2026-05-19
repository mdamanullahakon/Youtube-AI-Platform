export interface Project {
  id: string;
  topic: string;
  status: string;
  viralScore: number;
  competition: number;
  audience: string | null;
  format: string | null;
  title: string | null;
  description: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
  analytics?: {
    views: number;
    likes: number;
    comments: number;
  } | null;
  videoRender?: {
    videoUrl: string | null;
    status: string;
  } | null;
  uploadHistory?: {
    videoId: string | null;
    status: string;
  } | null;
}

export interface DashboardStats {
  totalProjects: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  subscribersGained: number;
  totalUploads: number;
}

export interface YouTubeChannel {
  id: string;
  channelId: string;
  channelTitle: string | null;
  channelAvatar: string | null;
  isConnected: boolean;
  lastSyncedAt: string;
  createdAt: string;
}

export interface UploadHistoryItem {
  id: string;
  projectId: string;
  videoId: string | null;
  title: string | null;
  status: string;
  createdAt: string;
  publishedAt: string | null;
  project?: {
    topic: string;
    analytics?: {
      views: number;
      likes: number;
      comments: number;
    } | null;
  } | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  data?: T;
  [key: string]: unknown;
}
