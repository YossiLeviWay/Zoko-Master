import { useState, useEffect, useRef } from 'react';
import { db } from '../../firebase';
import {
  query,
  orderBy,
  onSnapshot,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';
import { X, Send } from 'lucide-react';
import './Tasks.css';
import { schoolSubcollection } from '../../services/firestore/paths';

export default function ChatPanel({ task, schoolId, currentUser, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    const chatRef = schoolSubcollection(db, schoolId, 'tasks', task.id, 'chat');
    const q = query(chatRef, orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [schoolId, task.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim()) return;
    await addDoc(schoolSubcollection(db, schoolId, 'tasks', task.id, 'chat'), {
      text: text.trim(),
      author: currentUser?.fullName || 'משתמש',
      authorId: currentUser?.uid || '',
      createdAt: serverTimestamp()
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
        <button className="modal-close" onClick={onClose} aria-label="סגירת תגובות המשימה">
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
        <button type="submit" className="chat-send" disabled={!text.trim()} aria-label="שליחת תגובה">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
