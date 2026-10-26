import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  AlertCircle,
  Bot,
  ExternalLink,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  User,
} from 'lucide-react';
import { formatDateTime, type AssistantConversation, type AssistantMessage, type AssistantSource, type Garden } from '@growspace/shared';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  deleteAssistantConversation,
  fetchAssistantConversation,
  fetchAssistantConversations,
  fetchGardens,
  fetchPlants,
  sendAssistantMessage,
  type PlantWithDetails,
} from '@/lib/api';

const SUGGESTED_QUESTIONS = [
  'Which of my plants need attention?',
  'How has the moisture level changed this week?',
  'What care tasks should I prioritize today?',
  'Explain the latest readings for my plants.',
];

function createTempUserMessage(conversationId: string | null, content: string): AssistantMessage {
  return {
    id: `client-${Math.random().toString(36).slice(2, 9)}`,
    conversationId: conversationId ?? 'new',
    role: 'user',
    content,
    createdAt: new Date().toISOString(),
  };
}

export function FarmingAssistantPage() {
  const [conversations, setConversations] = useState<AssistantConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);

  const [inputMessage, setInputMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null);

  // Context Scoping Filters
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [plants, setPlants] = useState<PlantWithDetails[]>([]);
  const [selectedGardenId, setSelectedGardenId] = useState<string>('');
  const [selectedPlantId, setSelectedPlantId] = useState<string>('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load Gardens and Plants for Context Selector
  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    async function loadScopeData() {
      try {
        const [gardensRes, plantsRes] = await Promise.all([
          fetchGardens(controller.signal),
          fetchPlants({ signal: controller.signal }),
        ]);
        if (isMounted) {
          setGardens(gardensRes.gardens);
          setPlants(plantsRes.plants);
        }
      } catch {
        // Fallback gracefully
      }
    }

    void loadScopeData();
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  // Load Conversations List
  const refreshConversations = () => {
    fetchAssistantConversations()
      .then((res) => setConversations(res.conversations))
      .catch(() => {});
  };

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();
    fetchAssistantConversations({ signal: controller.signal })
      .then((res) => {
        if (isMounted) setConversations(res.conversations);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
      controller.abort();
    };
  }, []);

  // Switch Conversation Thread
  const handleSelectConversation = async (convId: string) => {
    if (convId === activeConversationId) return;
    setError(null);
    setIsLoadingHistory(true);
    setActiveConversationId(convId);

    try {
      const res = await fetchAssistantConversation(convId);
      setMessages(res.messages);
      if (res.conversation.gardenId) setSelectedGardenId(res.conversation.gardenId);
      if (res.conversation.plantId) setSelectedPlantId(res.conversation.plantId);
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'Failed to load conversation history.');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  // Start New Thread
  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setError(null);
    setInputMessage('');
    if (inputRef.current) inputRef.current.focus();
  };

  // Delete Conversation Thread
  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this conversation?')) return;

    try {
      await deleteAssistantConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversationId === convId) {
        handleNewConversation();
      }
    } catch (err: unknown) {
      const e2 = err as { message?: string };
      setError(e2.message || 'Failed to delete conversation.');
    }
  };

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isSending]);

  // Send Message Handler
  const handleSendMessage = async (textToSend?: string) => {
    const text = (textToSend ?? inputMessage).trim();
    if (!text || isSending) return;

    setError(null);
    setLastFailedMessage(null);
    setIsSending(true);

    const tempUserMessage = createTempUserMessage(activeConversationId, text);

    setMessages((prev) => [...prev, tempUserMessage]);
    setInputMessage('');

    try {
      const res = await sendAssistantMessage({
        message: text,
        conversationId: activeConversationId ?? undefined,
        gardenId: selectedGardenId || undefined,
        plantId: selectedPlantId || undefined,
      });

      setActiveConversationId(res.conversationId);
      setMessages((prev) => [...prev, res.message]);

      // Refresh conversations list to update titles/timestamps
      refreshConversations();
    } catch (err: unknown) {
      const e = err as { message?: string };
      setError(e.message || 'The AI assistant was unable to answer. Please try again.');
      setLastFailedMessage(text);
      // Remove temp user message or leave it for retry
    } finally {
      setIsSending(false);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleSendMessage();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  // Filtered Plants based on selected Garden
  const availablePlants = selectedGardenId
    ? plants.filter((p) => p.gardenId === selectedGardenId)
    : plants;

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      <PageHeader
        title="AI Farming Assistant"
        description="Ask questions about your crops, environmental readings, care tasks, and botanical best practices."
      />

      {/* Advisory Banner */}
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 flex items-start gap-2.5">
        <Sparkles className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
        <div className="leading-relaxed">
          <span className="font-semibold">Advisory Guidance:</span> AI Farming Assistant recommendations are based on your recorded telemetry and horticultural references. Always inspect your crops directly and verify environmental conditions before making drastic interventions.
        </div>
      </div>

      {/* Main Grid: Sidebar Threads + Chat View */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 flex-1 min-h-0">
        {/* Left: Conversation Threads Sidebar */}
        <Card className="hidden lg:flex flex-col p-3 border-slate-200 bg-slate-50/50 min-h-0">
          <div className="flex items-center justify-between mb-3 px-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Conversations
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleNewConversation}
              className="h-7 text-xs gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {conversations.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-400">
                No past conversations. Start a new question below.
              </div>
            ) : (
              conversations.map((c) => {
                const isActive = c.id === activeConversationId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void handleSelectConversation(c.id)}
                    className={`w-full text-left p-2.5 rounded-md text-xs transition-colors flex items-start justify-between group ${
                      isActive
                        ? 'bg-emerald-100/70 text-emerald-950 font-medium'
                        : 'hover:bg-slate-200/60 text-slate-700'
                    }`}
                  >
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <MessageSquare className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`} />
                      <div className="truncate">
                        <div className="truncate">{c.title}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          {formatDateTime(c.updatedAt)}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      aria-label="Delete conversation"
                      onClick={(e) => void handleDeleteConversation(c.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-600 transition-opacity p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </button>
                );
              })
            )}
          </div>
        </Card>

        {/* Right: Active Chat Area */}
        <Card className="lg:col-span-3 flex flex-col border-slate-200 bg-white min-h-0 shadow-sm">
          {/* Top Scope Filters */}
          <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex flex-wrap items-center gap-2.5 text-xs text-slate-600">
            <span className="font-medium text-slate-700">Context Scope:</span>
            <select
              value={selectedGardenId}
              onChange={(e) => {
                setSelectedGardenId(e.target.value);
                setSelectedPlantId(''); // Reset plant filter when garden changes
              }}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">All Gardens</option>
              {gardens.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>

            <select
              value={selectedPlantId}
              onChange={(e) => setSelectedPlantId(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="">All Plants</option>
              {availablePlants.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.customName || p.catalog?.commonName || 'Unnamed Plant'}
                </option>
              ))}
            </select>

            {(selectedGardenId || selectedPlantId) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedGardenId('');
                  setSelectedPlantId('');
                }}
                className="h-6 text-[11px] text-slate-500 hover:text-slate-800 px-1.5"
              >
                Clear Scope
              </Button>
            )}
          </div>

          {/* Messages Thread Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {isLoadingHistory ? (
              <div className="flex items-center justify-center h-48 text-xs text-slate-500 gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
                Loading conversation thread...
              </div>
            ) : messages.length === 0 ? (
              /* Empty State with Suggested Questions */
              <div className="max-w-xl mx-auto py-8 text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 mb-3">
                  <Bot className="h-6 w-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-800">
                  How can GrowSpace assist your crops today?
                </h3>
                <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                  Ask about soil moisture, overdue tasks, temperature trends, or general botanical guidance grounded in your garden data.
                </p>

                <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-2 text-left">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => void handleSendMessage(q)}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-300 text-xs text-slate-700 hover:text-emerald-900 transition-colors text-left flex items-start justify-between group"
                    >
                      <span>{q}</span>
                      <Send className="h-3 w-3 text-slate-300 group-hover:text-emerald-600 shrink-0 mt-0.5 ml-2" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Dialogue Messages */
              messages.map((m) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={m.id}
                    className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
                  >
                    <div
                      className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-xs font-medium ${
                        isUser
                          ? 'bg-slate-700 text-white'
                          : 'bg-emerald-700 text-white'
                      }`}
                    >
                      {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
                    </div>

                    <div
                      className={`rounded-xl px-4 py-3 max-w-[85%] text-xs leading-relaxed ${
                        isUser
                          ? 'bg-slate-800 text-white shadow-sm'
                          : 'bg-slate-100/90 text-slate-800 border border-slate-200 shadow-sm'
                      }`}
                    >
                      {/* Message Content with Paragraph Formatting */}
                      <div className="whitespace-pre-wrap space-y-2">
                        {m.content}
                      </div>

                      {/* Assistant Metadata Badges & Web Citations */}
                      {!isUser && m.metadata && (
                        <div className="mt-3 pt-2.5 border-t border-slate-200/80 space-y-2">
                          {/* Provenance Pills */}
                          {m.metadata.provenanceNotes && m.metadata.provenanceNotes.length > 0 && (
                            <div className="flex flex-wrap gap-1.5">
                              {m.metadata.provenanceNotes.map((note) => (
                                <span
                                  key={note}
                                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-200 text-slate-700"
                                >
                                  {note}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Source Citations */}
                          {m.metadata.sources && m.metadata.sources.length > 0 && (
                            <div className="space-y-1">
                              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                                References & Sources:
                              </span>
                              <div className="flex flex-wrap gap-1.5">
                                {m.metadata.sources.map((src: AssistantSource) => (
                                  <a
                                    key={src.url}
                                    href={src.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] text-emerald-800 hover:text-emerald-950 font-medium transition-colors"
                                  >
                                    <span>{src.publisher ? `${src.publisher}: ` : ''}{src.title}</span>
                                    <ExternalLink className="h-2.5 w-2.5 text-slate-400" />
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}

            {/* In-Flight Thinking Indicator */}
            {isSending && (
              <div className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-emerald-700 text-white flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-xl px-4 py-3 bg-slate-100 border border-slate-200 text-xs text-slate-600 flex items-center gap-2">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin text-emerald-600" />
                  <span>Analyzing farm telemetry and generating guidance...</span>
                </div>
              </div>
            )}

            {/* Error Message & Retry */}
            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>{error}</span>
                </div>
                {lastFailedMessage && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void handleSendMessage(lastFailedMessage)}
                    className="h-7 text-xs border-rose-300 hover:bg-rose-100 text-rose-800"
                  >
                    Retry
                  </Button>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Bottom Chat Input Bar */}
          <form onSubmit={handleSubmit} className="p-3 border-t border-slate-200 bg-white">
            <div className="relative flex items-end rounded-lg border border-slate-300 bg-white focus-within:border-emerald-500 focus-within:ring-1 focus-within:ring-emerald-500 shadow-sm">
              <textarea
                ref={inputRef}
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your plants, readings, care tasks, or cultivation practices..."
                disabled={isSending}
                rows={2}
                maxLength={2000}
                className="w-full resize-none border-0 bg-transparent px-3 py-2 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-0 leading-relaxed disabled:opacity-50"
              />
              <div className="flex items-center gap-2 p-2 shrink-0">
                <span className="text-[10px] text-slate-400">
                  {inputMessage.length}/2000
                </span>
                <Button
                  type="submit"
                  size="sm"
                  disabled={!inputMessage.trim() || isSending}
                  className="h-8 px-3 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>Send</span>
                </Button>
              </div>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
