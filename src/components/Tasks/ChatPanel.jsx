import { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc
} from 'firebase/firestore';
import { X, Send } from 'lucide-react';
import './Tasks.css';

export default function ChatPanel({ task, schoolId, currentUser, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  const chatPath = `tasks_${schoolId}/${task.id}/chat`;

  useEffect(() => {
    const q = query(collection(db, chatPath), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [chatPath]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await addDoc(collection(db, chatPath), {
      text: text.trim(),
      author: currentUser?.fullName || 'משתמש',
      authorId: currentUser?.uid || '',
      createdAt: new Date().toISOString()
    });
    setText('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div>
          <h4 className="chat-title">{task.title}</h4>
          <span className="chat-subtitle">צ׳אט משימה</span>
        </div>
        <button className="modal-close" onClick={onClose}>
          <X size={18} />
        </button>
      </div>

      <div className="chat-messages">
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
                  {new Date(msg.createdAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
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
        <button type="submit" className="chat-send" disabled={!text.trim()}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
