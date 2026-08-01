import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Building2,
  Edit3,
  Mail,
  Merge,
  Plus,
  Search,
  Shield,
  Tags,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { buildMailtoUrl } from '../../utils/mailto';
import Header from '../Layout/Header';
import PagePermissionsPanel from '../Shared/PagePermissionsPanel';
import {
  archiveContact,
  CONTACT_SCOPE,
  CONTACT_VISIBILITY,
  createContact,
  findDuplicateByEmail,
  mergeContacts,
  restoreContact,
  subscribeContacts,
  updateContact,
} from '../../services/firestore/contactRepository';
import './Contacts.css';

const EMPTY_FORM = Object.freeze({
  fullName: '', organization: '', jobTitle: '', primaryEmail: '', additionalEmailsText: '',
  phone: '', category: '', tagsText: '', notes: '', visibility: CONTACT_VISIBILITY.INSTITUTION,
  ownerStaffIds: [], archived: false,
});

function formFromContact(contact) {
  return {
    ...EMPTY_FORM,
    ...contact,
    additionalEmailsText: (contact.additionalEmails || []).join('\n'),
    tagsText: (contact.tags || []).join(', '),
    ownerStaffIds: contact.ownerStaffIds || [],
  };
}

function inputFromForm(form) {
  return {
    ...form,
    additionalEmails: form.additionalEmailsText.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean),
    tags: form.tagsText.split(',').map(value => value.trim()).filter(Boolean),
  };
}

function contactEmail(contact) {
  return contact.primaryEmail || contact.email || '';
}

export default function ContactsPage() {
  const { currentUser, userData, selectedSchool, isPrincipal, isGlobalAdmin } = useAuth();
  const { permissions } = usePermissions();
  const schoolId = selectedSchool || userData?.schoolId;
  const userId = currentUser?.uid || userData?.uid;
  const manager = isPrincipal() || isGlobalAdmin();
  const institutionalPermissions = useMemo(() => ({
    view: manager || permissions['contacts.view'] === true,
    create: manager || permissions['contacts.create'] === true,
    edit: manager || permissions['contacts.edit'] === true,
    archive: manager || permissions['contacts.archive'] === true,
    merge: manager || permissions['contacts.merge'] === true,
  }), [manager, permissions]);

  const [contacts, setContacts] = useState([]);
  const [staff, setStaff] = useState([]);
  const [tab, setTab] = useState(institutionalPermissions.view ? CONTACT_SCOPE.INSTITUTIONAL : CONTACT_SCOPE.PRIVATE);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [organization, setOrganization] = useState('all');
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState(null);
  const [mergeSource, setMergeSource] = useState(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPermissions, setShowPermissions] = useState(false);

  useEffect(() => {
    if (!schoolId || !userId) return undefined;
    setLoading(true);
    return subscribeContacts({
      db,
      schoolId,
      userId,
      includeInstitutional: institutionalPermissions.view,
      canReadRestricted: manager || institutionalPermissions.edit,
      onData: items => { setContacts(items); setLoading(false); },
      onError: () => { setError('לא ניתן לטעון את אנשי הקשר כרגע.'); setLoading(false); },
    });
  }, [institutionalPermissions.edit, institutionalPermissions.view, manager, schoolId, userId]);

  useEffect(() => {
    if (!schoolId) return undefined;
    let active = true;
    Promise.all([
      getDocs(query(collection(db, 'users'), where('schoolIds', 'array-contains', schoolId))),
      getDocs(query(collection(db, 'users'), where('schoolId', '==', schoolId))),
    ]).then(([multiSchool, legacy]) => {
      if (!active) return;
      const map = new Map();
      [...multiSchool.docs, ...legacy.docs].forEach(item => map.set(item.id, { id: item.id, ...item.data() }));
      setStaff([...map.values()].filter(item => item.accountStatus !== 'pending'));
    }).catch(() => setStaff([]));
    return () => { active = false; };
  }, [schoolId]);

  useEffect(() => {
    if (tab === CONTACT_SCOPE.INSTITUTIONAL && !institutionalPermissions.view) setTab(CONTACT_SCOPE.PRIVATE);
  }, [institutionalPermissions.view, tab]);

  const scopedContacts = useMemo(() => {
    if (tab === CONTACT_SCOPE.INTERNAL) return staff.map(item => ({ ...item, scope: CONTACT_SCOPE.INTERNAL }));
    return contacts.filter(item => item.scope === tab);
  }, [contacts, staff, tab]);

  const categories = useMemo(() => [...new Set(scopedContacts.map(item => item.category).filter(Boolean))].sort(), [scopedContacts]);
  const organizations = useMemo(() => [...new Set(scopedContacts.map(item => item.organization).filter(Boolean))].sort(), [scopedContacts]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return scopedContacts.filter(contact => {
      if (tab !== CONTACT_SCOPE.INTERNAL && Boolean(contact.archived) !== showArchived) return false;
      if (category !== 'all' && contact.category !== category) return false;
      if (organization !== 'all' && contact.organization !== organization) return false;
      if (!needle) return true;
      return [contact.fullName, contact.organization, contact.jobTitle, contact.primaryEmail, contact.email, contact.phone, ...(contact.tags || [])]
        .some(value => String(value || '').toLowerCase().includes(needle));
    }).sort((a, b) => String(a.fullName || '').localeCompare(String(b.fullName || ''), 'he'));
  }, [category, organization, scopedContacts, search, showArchived, tab]);

  const canCreateCurrent = tab === CONTACT_SCOPE.PRIVATE || (tab === CONTACT_SCOPE.INSTITUTIONAL && institutionalPermissions.create);
  const canEditContact = contact => contact.scope === CONTACT_SCOPE.PRIVATE || institutionalPermissions.edit;
  const canArchiveContact = contact => contact.scope === CONTACT_SCOPE.PRIVATE || institutionalPermissions.archive;

  function startCreate() {
    setEditing({ scope: tab, id: '' });
    setForm({ ...EMPTY_FORM, visibility: CONTACT_VISIBILITY.INSTITUTION });
    setDuplicate(null);
    setError('');
  }

  function startEdit(contact) {
    setEditing(contact);
    setForm(formFromContact(contact));
    setDuplicate(null);
    setError('');
  }

  function updateForm(field, value) {
    setForm(previous => ({ ...previous, [field]: value }));
  }

  async function saveContact(event) {
    event.preventDefault();
    const scope = editing.scope;
    const input = inputFromForm(form);
    const internalMatch = staff.find(item => item.email && item.email.trim().toLowerCase() === input.primaryEmail.trim().toLowerCase());
    if (internalMatch) {
      setError(`הכתובת שייכת לאיש הצוות ${internalMatch.fullName || internalMatch.email}. אין ליצור עבורו עותק נוסף.`);
      return;
    }
    const localDuplicate = findDuplicateByEmail(contacts, input, scope);
    if (localDuplicate && localDuplicate.id !== editing.id) {
      setDuplicate(localDuplicate);
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing.id) {
        await updateContact({
          db, schoolId, actor: { uid: userId }, scope, contactId: editing.id,
          input, permissions: institutionalPermissions,
        });
        setMessage('איש הקשר עודכן.');
      } else {
        await createContact({
          db, schoolId, actor: { uid: userId }, scope, input,
          permissions: institutionalPermissions,
        });
        setMessage(scope === CONTACT_SCOPE.PRIVATE ? 'איש הקשר הפרטי נשמר.' : 'איש הקשר המוסדי נשמר.');
      }
      setEditing(null);
    } catch (saveError) {
      if (saveError.message === 'DUPLICATE_CONTACT') setDuplicate(saveError.duplicate);
      else if (saveError.message === 'ORGANIZATION_OR_CATEGORY_REQUIRED') setError('באיש קשר מוסדי יש להזין ארגון או קטגוריה.');
      else setError('שמירת איש הקשר נכשלה. לא בוצע שינוי.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(contact) {
    const action = contact.archived ? 'לשחזר' : 'לארכב';
    if (!window.confirm(`${action} את ${contact.fullName}?`)) return;
    setError('');
    try {
      const fn = contact.archived ? restoreContact : archiveContact;
      await fn({ db, schoolId, actor: { uid: userId }, contact, permissions: institutionalPermissions });
      setMessage(contact.archived ? 'איש הקשר שוחזר.' : 'איש הקשר הועבר לארכיון.');
    } catch {
      setError('הפעולה לא נשמרה.');
    }
  }

  async function confirmMerge() {
    const target = contacts.find(item => item.scope === mergeSource.scope && item.id === mergeTargetId);
    if (!target) return;
    setSaving(true);
    try {
      await mergeContacts({
        db, schoolId, actor: { uid: userId }, source: mergeSource, target,
        permissions: institutionalPermissions,
      });
      setMessage(`הפרטים מוזגו לתוך ${target.fullName}. הרשומה המקורית אורכבה.`);
      setMergeSource(null);
      setMergeTargetId('');
    } catch {
      setError('מיזוג אנשי הקשר נכשל. לא בוצע שינוי.');
    } finally {
      setSaving(false);
    }
  }

  function openEmail(contact) {
    const email = contactEmail(contact);
    if (email) window.location.href = buildMailtoUrl({ to: [email], subject: '', body: '' });
  }

  return (
    <div className="page contacts-page" dir="rtl">
      <Header title="אנשי קשר" onPermissions={manager ? () => setShowPermissions(true) : undefined} />
      {showPermissions && <PagePermissionsPanel feature="contacts" onClose={() => setShowPermissions(false)} />}
      <main className="page-content contacts-content">
        <section className="contacts-hero">
          <div><span><Users size={17} /> ספר כתובות מאובטח</span><h1>אנשי קשר מוסדיים ופרטיים</h1><p>ניהול ספקים, שותפים ונמענים קבועים, בלי ליצור עותקים של אנשי הצוות.</p></div>
          <div className="contacts-hero-count"><strong>{contacts.filter(item => !item.archived).length}</strong><span>אנשי קשר פעילים</span></div>
        </section>

        {(message || error) && <div className={`contacts-feedback ${error ? 'contacts-feedback--error' : ''}`} role="status"><span>{error || message}</span><button onClick={() => { setMessage(''); setError(''); }} aria-label="סגירה"><X size={15} /></button></div>}

        <section className="contacts-toolbar">
          <div className="contacts-tabs">
            {institutionalPermissions.view && <button className={tab === CONTACT_SCOPE.INSTITUTIONAL ? 'active' : ''} onClick={() => setTab(CONTACT_SCOPE.INSTITUTIONAL)}><Building2 size={16} /> מוסדיים</button>}
            <button className={tab === CONTACT_SCOPE.PRIVATE ? 'active' : ''} onClick={() => setTab(CONTACT_SCOPE.PRIVATE)}><UserRound size={16} /> הפרטיים שלי</button>
            <button className={tab === CONTACT_SCOPE.INTERNAL ? 'active' : ''} onClick={() => setTab(CONTACT_SCOPE.INTERNAL)}><Shield size={16} /> אנשי צוות</button>
          </div>
          {canCreateCurrent && <button className="btn btn-primary" onClick={startCreate}><Plus size={16} /> איש קשר חדש</button>}
        </section>

        <section className="contacts-filters">
          <label className="contacts-search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="חיפוש לפי שם, ארגון, מייל או תגית..." /></label>
          {tab !== CONTACT_SCOPE.INTERNAL && <>
            <select value={organization} onChange={event => setOrganization(event.target.value)}><option value="all">כל הארגונים</option>{organizations.map(value => <option key={value}>{value}</option>)}</select>
            <select value={category} onChange={event => setCategory(event.target.value)}><option value="all">כל הקטגוריות</option>{categories.map(value => <option key={value}>{value}</option>)}</select>
            <label className="contacts-archive-toggle"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} /> הצגת ארכיון</label>
          </>}
          <span className="contacts-result-count">{filtered.length} תוצאות</span>
        </section>

        {loading ? <div className="contacts-empty">טוען אנשי קשר...</div> : filtered.length === 0 ? <div className="contacts-empty"><Users size={34} /><h2>אין אנשי קשר להצגה</h2><p>{tab === CONTACT_SCOPE.PRIVATE ? 'אנשי קשר פרטיים גלויים רק לך.' : 'אפשר ליצור איש קשר חדש או לשנות את הסינון.'}</p></div> : (
          <div className="contacts-grid">
            {filtered.map(contact => <article className={`contact-card ${contact.archived ? 'contact-card--archived' : ''}`} key={`${contact.scope}:${contact.id}`}>
              <header><div className="contact-avatar">{contact.fullName?.charAt(0) || '?'}</div><div><h2>{contact.fullName || 'ללא שם'}</h2><p>{contact.jobTitle || (contact.scope === CONTACT_SCOPE.INTERNAL ? 'איש צוות' : 'איש קשר')} {contact.organization ? `· ${contact.organization}` : ''}</p></div>{contact.scope === CONTACT_SCOPE.PRIVATE && <span className="contact-private-badge">פרטי</span>}</header>
              <div className="contact-details">{contactEmail(contact) && <button onClick={() => openEmail(contact)} dir="ltr"><Mail size={14} /> {contactEmail(contact)}</button>}{contact.phone && <span dir="ltr">{contact.phone}</span>}</div>
              {(contact.category || contact.tags?.length > 0) && <div className="contact-tags"><Tags size={13} />{contact.category && <span>{contact.category}</span>}{(contact.tags || []).map(tag => <span key={tag}>{tag}</span>)}</div>}
              {contact.notes && <p className="contact-notes">{contact.notes}</p>}
              <footer><button className="btn btn-secondary btn-sm" onClick={() => openEmail(contact)} disabled={!contactEmail(contact)}><Mail size={14} /> מייל</button>{contact.scope !== CONTACT_SCOPE.INTERNAL && canEditContact(contact) && <button className="icon-btn" onClick={() => startEdit(contact)} title="עריכה"><Edit3 size={15} /></button>}{contact.scope !== CONTACT_SCOPE.INTERNAL && canArchiveContact(contact) && <button className="icon-btn" onClick={() => toggleArchive(contact)} title={contact.archived ? 'שחזור' : 'ארכוב'}>{contact.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}</button>}{!contact.archived && contact.scope !== CONTACT_SCOPE.INTERNAL && (contact.scope === CONTACT_SCOPE.PRIVATE || institutionalPermissions.merge) && <button className="icon-btn" onClick={() => { setMergeSource(contact); setMergeTargetId(''); }} title="מיזוג"><Merge size={15} /></button>}</footer>
            </article>)}
          </div>
        )}
      </main>

      {editing && <div className="contacts-modal-overlay" onClick={() => setEditing(null)}><section className="contacts-modal" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="עריכת איש קשר">
        <header><div><span>{editing.scope === CONTACT_SCOPE.PRIVATE ? 'איש קשר פרטי' : 'איש קשר מוסדי'}</span><h2>{editing.id ? 'עריכת איש קשר' : 'איש קשר חדש'}</h2></div><button className="icon-btn" onClick={() => setEditing(null)}><X size={18} /></button></header>
        <form onSubmit={saveContact}>
          <div className="form-row"><label className="form-group"><span>שם מלא</span><input required maxLength={160} value={form.fullName} onChange={event => updateForm('fullName', event.target.value)} /></label><label className="form-group"><span>ארגון</span><input maxLength={160} value={form.organization} onChange={event => updateForm('organization', event.target.value)} /></label></div>
          <div className="form-row"><label className="form-group"><span>תפקיד</span><input maxLength={120} value={form.jobTitle} onChange={event => updateForm('jobTitle', event.target.value)} /></label><label className="form-group"><span>קטגוריה</span><input maxLength={80} value={form.category} onChange={event => updateForm('category', event.target.value)} placeholder="ספק, עירייה, מעסיק..." /></label></div>
          <div className="form-row"><label className="form-group"><span>מייל ראשי</span><input required type="email" dir="ltr" value={form.primaryEmail} onChange={event => updateForm('primaryEmail', event.target.value)} /></label><label className="form-group"><span>טלפון</span><input dir="ltr" maxLength={40} value={form.phone} onChange={event => updateForm('phone', event.target.value)} /></label></div>
          <label className="form-group"><span>כתובות מייל נוספות — אחת בכל שורה</span><textarea dir="ltr" rows={2} value={form.additionalEmailsText} onChange={event => updateForm('additionalEmailsText', event.target.value)} /></label>
          <label className="form-group"><span>תגיות — מופרדות בפסיקים</span><input value={form.tagsText} onChange={event => updateForm('tagsText', event.target.value)} /></label>
          <label className="form-group"><span>הערות</span><textarea rows={3} maxLength={2000} value={form.notes} onChange={event => updateForm('notes', event.target.value)} /></label>
          {editing.scope === CONTACT_SCOPE.INSTITUTIONAL && <><label className="form-group"><span>רמת חשיפה</span><select value={form.visibility} onChange={event => updateForm('visibility', event.target.value)}><option value={CONTACT_VISIBILITY.INSTITUTION}>כל בעלי הרשאת צפייה באנשי קשר</option><option value={CONTACT_VISIBILITY.RESPONSIBLE_STAFF}>אחראים ומנהלים בלבד</option></select></label><fieldset className="contact-owners"><legend>אנשי צוות אחראים</legend>{staff.map(member => <label key={member.id}><input type="checkbox" checked={form.ownerStaffIds.includes(member.id)} onChange={event => updateForm('ownerStaffIds', event.target.checked ? [...form.ownerStaffIds, member.id] : form.ownerStaffIds.filter(id => id !== member.id))} /> {member.fullName || member.email}</label>)}</fieldset></>}
          {duplicate && <div className="contact-duplicate"><strong>נמצא איש קשר עם אותה כתובת</strong><span>{duplicate.fullName} · {duplicate.primaryEmail}</span><button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setDuplicate(null); setSearch(duplicate.primaryEmail); setTab(duplicate.scope); }}>הצגת הרשומה הקיימת</button></div>}
          {error && <p className="contacts-form-error">{error}</p>}
          <footer><button className="btn btn-primary" disabled={saving || Boolean(duplicate)}>{saving ? 'שומר...' : 'שמירה'}</button><button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>ביטול</button></footer>
        </form>
      </section></div>}

      {mergeSource && <div className="contacts-modal-overlay" onClick={() => setMergeSource(null)}><section className="contacts-modal contacts-modal--small" onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="מיזוג אנשי קשר"><header><div><span>מניעת כפילויות</span><h2>מיזוג {mergeSource.fullName}</h2></div><button className="icon-btn" onClick={() => setMergeSource(null)}><X size={18} /></button></header><div className="contacts-merge-body"><p>בחרו את הרשומה שתישאר פעילה. כתובות המייל והתגיות יאוחדו, והרשומה הנוכחית תעבור לארכיון.</p><select value={mergeTargetId} onChange={event => setMergeTargetId(event.target.value)}><option value="">בחירת איש קשר יעד</option>{contacts.filter(item => item.scope === mergeSource.scope && item.id !== mergeSource.id && !item.archived).map(item => <option key={item.id} value={item.id}>{item.fullName} — {item.primaryEmail}</option>)}</select><div><button className="btn btn-primary" disabled={!mergeTargetId || saving} onClick={confirmMerge}>מיזוג הרשומות</button><button className="btn btn-secondary" onClick={() => setMergeSource(null)}>ביטול</button></div></div></section></div>}
    </div>
  );
}
