import { createContext, useContext, useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';

const AuthContext = createContext();

const GLOBAL_ADMIN_PASSWORD = '123qwe123';

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [currentUser, setCurrentUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedSchool, setSelectedSchool] = useState(null);

  async function register(email, password, userInfo) {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const schoolId = userInfo.schoolId || '';
    const userDoc = {
      uid: cred.user.uid,
      email,
      fullName: userInfo.fullName,
      role: 'viewer',
      jobTitle: userInfo.jobTitle || '',
      schoolId: schoolId,
      schoolIds: [],
      pendingSchools: schoolId ? [schoolId] : [],
      phone: userInfo.phone || '',
      avatar: '',
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', cred.user.uid), userDoc);
    return cred;
  }

  async function login(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Check if admin set a new password for this user
    try {
      const userDoc = await getDoc(doc(db, 'users', cred.user.uid));
      const data = userDoc.data();
      if (data?._pendingPassword) {
        await updatePassword(cred.user, data._pendingPassword);
        await updateDoc(doc(db, 'users', cred.user.uid), { _pendingPassword: '', _authPassword: data._pendingPassword });
      }
    } catch (err) {
      console.warn('Could not apply pending password:', err);
    }
    return cred;
  }

  async function loginAsAdmin(password) {
    if (password !== GLOBAL_ADMIN_PASSWORD) {
      throw new Error('סיסמת אדמין שגויה');
    }
    const adminEmail = 'admin@eduflow.co.il';
    let cred;
    try {
      cred = await signInWithEmailAndPassword(auth, adminEmail, GLOBAL_ADMIN_PASSWORD);
    } catch (signInErr) {
      if (signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/user-not-found') {
        cred = await createUserWithEmailAndPassword(auth, adminEmail, GLOBAL_ADMIN_PASSWORD);
      } else {
        console.error('Admin sign-in error:', signInErr.code, signInErr.message);
        throw signInErr;
      }
    }
    try {
      const userRef = doc(db, 'users', cred.user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: cred.user.uid,
          email: adminEmail,
          fullName: 'מנהל מערכת',
          role: 'global_admin',
          jobTitle: 'מנהל על',
          schoolId: '',
          schoolIds: [],
          pendingSchools: [],
          phone: '',
          avatar: '',
          createdAt: new Date().toISOString()
        });
      }
    } catch (firestoreErr) {
      console.warn('Could not write admin doc:', firestoreErr.code, firestoreErr.message);
    }
    return cred;
  }

  async function logout() {
    // Mark user as offline before signing out
    if (currentUser) {
      try { await updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: new Date().toISOString() }); } catch {}
    }
    setUserData(null);
    setSelectedSchool(null);
    return signOut(auth);
  }

  async function fetchUserData(uid) {
    const docSnap = await getDoc(doc(db, 'users', uid));
    if (docSnap.exists()) {
      const data = docSnap.data();
      setUserData(data);
      // Handle both new schoolIds array and old schoolId field
      if (data.schoolIds && data.schoolIds.length > 0) {
        setSelectedSchool(data.schoolIds[0]);
      } else if (data.schoolId) {
        setSelectedSchool(data.schoolId);
      }
      return data;
    }
    return null;
  }

  async function approveUser(userId, schoolId) {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      pendingSchools: arrayRemove(schoolId),
      schoolIds: arrayUnion(schoolId)
    });
  }

  async function rejectUser(userId, schoolId) {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      pendingSchools: arrayRemove(schoolId)
    });
  }

  function switchSchool(schoolId) {
    setSelectedSchool(schoolId);
  }

  function isGlobalAdmin() {
    return userData?.role === 'global_admin';
  }

  function isPrincipal() {
    return userData?.role === 'principal';
  }

  function isEditor() {
    return userData?.role === 'editor';
  }

  function isPending() {
    if (!userData) return false;
    if (userData.role === 'global_admin') return false;
    const hasApprovedSchools = (userData.schoolIds && userData.schoolIds.length > 0) || userData.schoolId;
    const hasPending = userData.pendingSchools && userData.pendingSchools.length > 0;
    return !hasApprovedSchools && hasPending;
  }

  function isViewer() {
    return userData?.role === 'viewer';
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      if (user) {
        await fetchUserData(user.uid);
        // Mark user as online
        try { await updateDoc(doc(db, 'users', user.uid), { isOnline: true, lastSeen: new Date().toISOString() }); } catch {}
      } else {
        setUserData(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  // Periodic heartbeat to keep online status fresh (every 2 minutes)
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      try { updateDoc(doc(db, 'users', currentUser.uid), { lastSeen: new Date().toISOString(), isOnline: true }); } catch {}
    }, 120000);
    // Mark offline on page close
    function handleBeforeUnload() {
      try { navigator.sendBeacon && updateDoc(doc(db, 'users', currentUser.uid), { isOnline: false, lastSeen: new Date().toISOString() }); } catch {}
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUser?.uid]);

  const value = {
    currentUser,
    userData,
    selectedSchool,
    loading,
    register,
    login,
    loginAsAdmin,
    logout,
    switchSchool,
    isGlobalAdmin,
    isPrincipal,
    isEditor,
    fetchUserData,
    approveUser,
    rejectUser,
    isPending,
    isViewer
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}
