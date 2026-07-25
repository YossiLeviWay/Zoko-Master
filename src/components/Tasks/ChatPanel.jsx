import { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import { X, Send } from 'lucide-react';
import './Tasks.css';
import {
  markTaskChatRead,
  sendTaskChatMessage,
  subscribeTaskChat,
} from '../../services/firestore/taskRepository';

export default function ChatPanel({ task, schoolId, currentUser, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    return subscribeTaskChat({
      db,
      schoolId,
      task,
      onData: items => {
        setMessages(items);
        markTaskChatRead({ db, schoolId, uid: currentUser?.uid, task }).catch(() => undefined);
      },
      onError: () => setError('לא ניתן לטעון את הודעות המשימה.'),
    });
  }, [currentUser?.uid, schoolId, task]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      await sendTaskChatMessage({ db, schoolId, task, user: currentUser, text });
      setText('');
    } catch {
      setError('שליחת ההודעה נכשלה.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div>
          <h4 className="chat-title">{task.title}</h4>
          <span className="chat-subtitle">צ׳אט משימה</span>
        </div>
        <button className="modal-close" onClick={onClose} aria-label="סגירת תגובות המשימה">
          <X size={18} />
        </button>
      </div>

      <div className="chat-messages">
        {error && <div className="task-feedback task-feedback--error" role="alert">{error}</div>}
        {messages.length === 0 && (
          <div className="chat-empty">אין הודעות עדיין</div>
        )}
        {messages.map(msg => {
          const isMe = msg.authorId === currentUser?.uid;
          return (
            <div key={msg.id} className={`chat-msg ${isMe ? 'chat-msg--me' : ''}`}>
              <div className="chat-msg-header">
                <span className="chat-msg-author">{msg.author}</span>
                <span className="chat-msg-time">
                  {(msg.createdAt?.toDate?.() || new Date(msg.createdAt || Date.now())).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="chat-msg-text">{msg.text}</div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="כתבו הודעה..."
          autoFocus
        />
        <button type="submit" className="chat-send" disabled={!text.trim() || sending} aria-label="שליחת תגובה">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
