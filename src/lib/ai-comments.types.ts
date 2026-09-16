export interface AIComment {
  id: string;
  userName: string;
  userAvatar: string;
  rating: number | null;
  content: string;
  time: string;
  votes: number;
  isAiGenerated: true;
}

export interface AICommentMovie {
  name: string;
  year: string;
  info: string;
  count: number;
}

export interface SavedAIComments {
  canGenerate?: boolean;
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed';
  jobId?: string;
  generationId?: string;
  comments: AIComment[];
  total: number;
  movieName: string;
  generatedAt?: string;
  error?: string;
  isAiGenerated: true;
}
