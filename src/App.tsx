import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import { Check, CircleAlert, Copy, MessageCircle, Plus, Send, UserRound, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import treasurerLogo from "../images/CASTO.jpg";
import { readChatStream } from "./chat-stream";

type Message = { id: string; role: "user" | "assistant"; content: string };
type SavedSession = { conversationId?: string; messages: Message[] };

const STORAGE_KEY = "treasurer-assist-session";
const suggestions = [
  "What does the Treasurer's Office do?",
  "Where can I learn about California bonds?",
  "Help me find a state financing program.",
];

function loadSession(): SavedSession {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? (JSON.parse(saved) as SavedSession) : { messages: [] };
  } catch {
    return { messages: [] };
  }
}

function App() {
  const [session, setSession] = useState<SavedSession>(loadSession);
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  const [copiedId, setCopiedId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    fetch("/api/status")
      .then((result) => setConnected(result.ok))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    window.parent.postMessage({ type: "treasurer-chat:resize", open: isOpen }, "*");
    if (isOpen) window.setTimeout(() => inputRef.current?.focus(), 180);
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isSending ? "auto" : "smooth" });
  }, [session.messages, isSending, streamingText]);

  const startNewConversation = () => {
    if (sendingRef.current) return;
    if (session.conversationId) {
      fetch(`/api/conversations/${encodeURIComponent(session.conversationId)}`, { method: "DELETE" }).catch(() => undefined);
    }
    setSession({ messages: [] });
    setInput("");
    setError("");
  };

  const sendMessage = async (text = input) => {
    const message = text.trim();
    if (!message || sendingRef.current) return;
    sendingRef.current = true;

    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: message };
    setInput("");
    setError("");
    setStreamingText("");
    setIsSending(true);
    setSession((current) => ({ ...current, messages: [...current.messages, userMessage] }));

    try {
      const result = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({ message, conversationId: session.conversationId }),
      });
      await readChatStream(result, (event) => {
        if (event.type === "start") {
          setSession((current) => ({ ...current, conversationId: event.conversationId }));
        } else if (event.type === "delta") {
          setStreamingText((current) => current + event.text);
        } else {
          setStreamingText("");
          setSession((current) => ({
            conversationId: event.conversationId,
            messages: [
              ...current.messages,
              { id: crypto.randomUUID(), role: "assistant", content: event.message },
            ],
          }));
        }
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The assistant is unavailable.");
    } finally {
      sendingRef.current = false;
      setStreamingText("");
      setIsSending(false);
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const copyMessage = async (message: Message) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId(""), 1600);
  };

  return (
    <div className={`widget-shell ${isOpen ? "is-open" : ""}`}>
      {isOpen && (
        <section className="chat-window" aria-label="Treasurer Assist chat">
          <header className="widget-header">
            <div className="header-mark"><img src={treasurerLogo} alt="" /></div>
            <div className="header-title">
              <strong>Treasurer Assist</strong>
              <span><i className={connected === false ? "offline" : ""} />{connected === false ? "Temporarily unavailable" : "Official virtual assistant"}</span>
            </div>
            <button className="header-button" onClick={startNewConversation} disabled={isSending} aria-label="Start a new conversation" title="New conversation"><Plus /></button>
            <button className="header-button" onClick={() => setIsOpen(false)} aria-label="Close chat"><X /></button>
          </header>

          <div className="conversation" aria-live="polite">
            {session.messages.length === 0 ? (
              <div className="welcome">
                <div className="welcome-mark"><img src={treasurerLogo} alt="California State Treasurer's Office seal" /></div>
                <h1>How can we help?</h1>
                <p>Ask about the State Treasurer's Office, public finance, programs, and resources.</p>
                <div className="suggestions">
                  {suggestions.map((suggestion) => <button key={suggestion} onClick={() => void sendMessage(suggestion)}>{suggestion}</button>)}
                </div>
                <div className="notice"><CircleAlert aria-hidden="true" /> Informational responses are not financial or legal advice.</div>
              </div>
            ) : (
              <div className="message-list">
                {session.messages.map((message) => (
                  <article className={`message ${message.role}`} key={message.id}>
                    <div className="avatar">{message.role === "assistant" ? <img src={treasurerLogo} alt="" /> : <UserRound aria-hidden="true" />}</div>
                    <div className="message-content">
                      <div className="message-meta">{message.role === "assistant" ? "Treasurer Assist" : "You"}</div>
                      <div className="message-body">
                        <ReactMarkdown components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>
                          {message.content}
                        </ReactMarkdown>
                      </div>
                      {message.role === "assistant" && (
                        <button className="copy-button" onClick={() => void copyMessage(message)} aria-label="Copy response">
                          {copiedId === message.id ? <Check /> : <Copy />}{copiedId === message.id ? "Copied" : "Copy"}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
                {isSending && (
                  <article className="message assistant">
                    <div className="avatar"><img src={treasurerLogo} alt="" /></div>
                    <div className="message-content">
                      <div className="message-meta">Treasurer Assist</div>
                      {streamingText ? (
                        <div className="message-body">
                          <ReactMarkdown components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer">{children}</a> }}>
                            {streamingText}
                          </ReactMarkdown>
                        </div>
                      ) : <div className="thinking"><i /><i /><i /><span>Reviewing your question</span></div>}
                    </div>
                  </article>
                )}
                {error && <div className="error-banner"><CircleAlert aria-hidden="true" />{error}</div>}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          <footer className="composer-wrap">
            <form className="composer" onSubmit={handleSubmit}>
              <textarea ref={inputRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Treasurer Assist" rows={1} maxLength={8000} aria-label="Message" />
              <button type="submit" disabled={!input.trim() || isSending} aria-label="Send message"><Send /></button>
            </form>
            <p>Powered by Microsoft Foundry</p>
          </footer>
        </section>
      )}

      <button className="chat-launcher" onClick={() => setIsOpen((open) => !open)} aria-label={isOpen ? "Close Treasurer Assist" : "Open Treasurer Assist"} aria-expanded={isOpen}>
        {isOpen ? <X aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
        {!isOpen && <span>Ask Treasurer Assist</span>}
      </button>
    </div>
  );
}

export default App;