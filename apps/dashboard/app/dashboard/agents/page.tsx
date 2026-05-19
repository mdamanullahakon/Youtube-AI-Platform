'use client';

const agents = [
  {
    name: 'Trend Research Agent',
    icon: '🔍',
    description: 'Analyzes YouTube trends, Reddit discussions, and Google Trends to identify viral topics.',
    status: 'active',
    model: 'Ollama LLaMA 3',
  },
  {
    name: 'Script Writer Agent',
    icon: '✍️',
    description: 'Generates viral scripts with curiosity hooks, retention loops, and emotional storytelling.',
    status: 'active',
    model: 'Ollama LLaMA 3',
  },
  {
    name: 'Visual Prompt Agent',
    icon: '🎨',
    description: 'Creates cinematic prompts for Runway, Midjourney, Stable Diffusion, and Flux.',
    status: 'active',
    model: 'Ollama LLaMA 3',
  },
  {
    name: 'Voiceover Agent',
    icon: '🎙️',
    description: 'Generates realistic voiceovers using ElevenLabs with emotional tones and natural pauses.',
    status: 'active',
    model: 'ElevenLabs',
  },
  {
    name: 'Thumbnail Agent',
    icon: '🖼️',
    description: 'Creates high-CTR thumbnails with emotional designs and curiosity-based layouts.',
    status: 'active',
    model: 'DALL-E / Stable Diffusion',
  },
  {
    name: 'SEO Agent',
    icon: '📊',
    description: 'Optimizes titles, descriptions, tags, and hashtags for maximum discoverability.',
    status: 'active',
    model: 'Ollama LLaMA 3',
  },
  {
    name: 'Analytics Agent',
    icon: '📈',
    description: 'Analyzes CTR, retention, engagement, and watch time to improve future videos.',
    status: 'active',
    model: 'Ollama LLaMA 3',
  },
  {
    name: 'Upload Agent',
    icon: '📤',
    description: 'Automatically uploads videos to YouTube with scheduling and multi-channel support.',
    status: 'active',
    model: 'YouTube API',
  },
];

export default function AgentsPage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">AI Agents</h1>
        <p className="text-muted mt-1">Autonomous AI content creation team</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {agents.map((agent) => (
          <div key={agent.name} className="glow-card rounded-xl p-6 animate-in">
            <div className="flex items-start justify-between mb-4">
              <span className="text-3xl">{agent.icon}</span>
              <span className="text-xs px-2 py-1 rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                {agent.status}
              </span>
            </div>
            <h3 className="font-semibold mb-2">{agent.name}</h3>
            <p className="text-sm text-muted mb-3">{agent.description}</p>
            <p className="text-xs text-primary">Model: {agent.model}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
