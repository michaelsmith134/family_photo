import React, { useState, useEffect } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// Global variables for Firebase configuration. These are automatically provided by the environment.
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// The main application component.
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [folders, setFolders] = useState({});
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [message, setMessage] = useState('');
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);

  // Initialize Firebase and set up authentication
  // This effect runs only once on component mount.
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestoreDb = getFirestore(app);
      const firebaseAuth = getAuth(app);
      setDb(firestoreDb);
      setAuth(firebaseAuth);

      // Set up the authentication state listener.
      const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          // Sign in using the custom token if available, otherwise sign in anonymously.
          if (initialAuthToken) {
            await signInWithCustomToken(firebaseAuth, initialAuthToken);
          } else {
            await signInAnonymously(firebaseAuth);
          }
        }
      });
      return () => unsubscribeAuth();
    } catch (error) {
      console.error("Firebase Initialization Error:", error);
      setMessage("Failed to initialize the app. Please check the console for details.");
    }
  }, []);

  // Set up a real-time listener for the user's gallery data.
  // This effect runs whenever the database or user ID changes.
  // We've removed `activeFolderId` from the dependency array to prevent the infinite loop.
  useEffect(() => {
    if (!db || !userId) return;

    // Use the correct Firestore security rules path for private user data.
    const userGalleryRef = doc(db, 'artifacts', appId, 'users', userId, 'gallery', 'data');
    
    // Listen for changes to the entire gallery document.
    const unsubscribe = onSnapshot(userGalleryRef, (docSnap) => {
      if (docSnap.exists()) {
        const galleryData = docSnap.data();
        const newFolders = galleryData.folders || {};
        setFolders(newFolders);

        // Check if the currently active folder still exists in the database.
        // This is a crucial check to prevent errors if a folder is deleted by another user.
        if (activeFolderId && !newFolders[activeFolderId]) {
          const folderKeys = Object.keys(newFolders);
          setActiveFolderId(folderKeys.length > 0 ? folderKeys[0] : null);
        } else if (!activeFolderId && Object.keys(newFolders).length > 0) {
           // If there is no active folder selected, but folders exist, set the first one as active.
           setActiveFolderId(Object.keys(newFolders)[0]);
        }
      } else {
        // Initialize the gallery document if it doesn't exist.
        setDoc(userGalleryRef, { folders: {} }).catch(err => console.error("Error initializing gallery:", err));
        setFolders({});
        setActiveFolderId(null);
      }
    });

    return () => unsubscribe();
  }, [db, userId]); // Dependency array only includes `db` and `userId`.

  // Handles the creation of a new folder.
  const handleCreateFolder = async () => {
    if (!db || !userId || !newFolderName.trim()) {
      setMessage("Please enter a folder name.");
      return;
    }
    const folderId = newFolderName.trim().replace(/\s+/g, '-').toLowerCase() + '-' + Date.now();
    
    try {
      const userGalleryRef = doc(db, 'artifacts', appId, 'users', userId, 'gallery', 'data');
      await setDoc(userGalleryRef, {
        folders: {
          ...folders,
          [folderId]: {
            name: newFolderName.trim(),
            images: []
          }
        }
      }, { merge: true });
      
      setNewFolderName('');
      setActiveFolderId(folderId);
      setMessage("Folder created successfully!");
    } catch (error) {
      console.error("Error creating folder:", error);
      setMessage("Failed to create folder.");
    }
  };

  // Handles file upload. Supports both images and videos.
  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (files.length === 0 || !activeFolderId) {
      setMessage("Please select a folder and a file to upload.");
      return;
    }

    const folderToUpdate = folders[activeFolderId];
    if (!folderToUpdate) {
        setMessage("Selected folder not found.");
        return;
    }

    const newMedia = [];
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
        const reader = new FileReader();
        const promise = new Promise((resolve) => {
          reader.onload = (e) => {
            newMedia.push({ dataUrl: e.target.result, name: file.name, mimeType: file.type });
            resolve();
          };
        });
        reader.readAsDataURL(file);
        await promise;
      }
    }

    try {
      const userGalleryRef = doc(db, 'artifacts', appId, 'users', userId, 'gallery', 'data');
      const updatedMedia = [...folderToUpdate.images, ...newMedia];
      
      // WARNING: Storing base64 data directly in Firestore documents is not scalable and is limited to 1MB per document.
      // For a production app, use Firebase Cloud Storage to store the image files and save the URLs in Firestore.
      await setDoc(userGalleryRef, {
        folders: {
          [activeFolderId]: {
            ...folderToUpdate,
            images: updatedMedia
          }
        }
      }, { merge: true });
      
      setMessage(`${newMedia.length} file(s) uploaded successfully!`);
    } catch (error) {
      console.error("Error uploading files:", error);
      setMessage("Failed to upload files.");
    }
  };

  // Handles the removal of the currently active folder.
  const handleRemoveFolder = async () => {
    if (!db || !userId || !activeFolderId) {
      setMessage("Please select a folder to remove.");
      return;
    }
    
    // Create a new object without the active folder.
    const updatedFolders = { ...folders };
    delete updatedFolders[activeFolderId];

    try {
      const userGalleryRef = doc(db, 'artifacts', appId, 'users', userId, 'gallery', 'data');
      await setDoc(userGalleryRef, { folders: updatedFolders });
      
      setActiveFolderId(null);
      setMessage("Folder removed successfully!");
      setIsConfirmingDelete(false);
    } catch (error) {
      console.error("Error removing folder:", error);
      setMessage("Failed to remove folder.");
      setIsConfirmingDelete(false);
    }
  };

  const currentMedia = activeFolderId && folders[activeFolderId] ? folders[activeFolderId].images : [];

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-8 bg-[url('https://source.unsplash.com/random/1920x1080/?jamaica,reggae,beach,vibrant')] bg-cover bg-center relative font-sans">
      <script src="https://cdn.tailwindcss.com"></script>
      <div className="absolute inset-0 bg-black opacity-30 z-0"></div>
      <div className="container max-w-6xl w-full bg-white bg-opacity-90 backdrop-blur-md rounded-3xl shadow-2xl p-6 sm:p-8 z-10 flex flex-col gap-6">
        
        {/* Header */}
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-gray-800">Family Photo Gallery</h1>
          <p className="text-lg text-gray-700 mt-2">Share your cherished moments with a touch of sunshine.</p>
        </header>

        {/* Gallery Section */}
        <section>
          <h2 className="text-2xl font-bold text-gray-800 mb-4 text-center">
            {activeFolderId ? folders[activeFolderId]?.name : 'Your Gallery'}
          </h2>
          <div id="gallery-container" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {currentMedia.length > 0 ? (
              currentMedia.map((media, index) => (
                <div key={index} className="gallery-item rounded-xl overflow-hidden shadow-lg transition-transform duration-200 hover:scale-105">
                  {media.mimeType.startsWith('video/') ? (
                    <video src={media.dataUrl} controls loop className="w-full h-auto object-cover aspect-square" />
                  ) : (
                    <img src={media.dataUrl} alt={media.name} className="w-full h-auto object-cover aspect-square" />
                  )}
                </div>
              ))
            ) : (
              <p className="text-gray-500 col-span-full text-center py-10">No photos or videos in this folder yet. Upload some to see them here!</p>
            )}
          </div>
        </section>

        {/* Combined Control Section */}
        <section className="bg-yellow-50 rounded-2xl shadow-inner p-6 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-xl font-semibold text-gray-700" htmlFor="folder-select">Select a Folder</label>
            <select
              id="folder-select"
              value={activeFolderId || ''}
              onChange={(e) => { setActiveFolderId(e.target.value); setIsConfirmingDelete(false); }}
              className="p-2 rounded-lg border border-gray-300 bg-white focus:ring-green-500 focus:border-green-500"
            >
              <option value="" disabled>-- Choose a folder --</option>
              {Object.entries(folders).map(([id, folder]) => (
                <option key={id} value={id}>
                  {folder.name} ({folder.images.length})
                </option>
              ))}
            </select>
            {Object.keys(folders).length === 0 && (
              <p className="text-gray-500 text-sm mt-2">No folders yet. Create one below.</p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 items-center">
            <input 
              type="text" 
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New Folder Name"
              className="flex-1 p-2 rounded-lg border border-gray-300 focus:ring-green-500 focus:border-green-500"
            />
            <button 
              onClick={handleCreateFolder}
              className="w-full sm:w-auto bg-green-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-green-700 transition"
            >
              Create
            </button>
            <button 
              onClick={() => setIsConfirmingDelete(true)}
              className={`w-full sm:w-auto bg-red-600 text-white font-bold py-2 px-4 rounded-lg shadow-lg hover:bg-red-700 transition ${
                !activeFolderId && 'opacity-50 cursor-not-allowed'
              }`}
              disabled={!activeFolderId}
            >
              Remove Folder
            </button>
          </div>

          {isConfirmingDelete && (
            <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 rounded-lg" role="alert">
              <p className="font-bold">Are you sure?</p>
              <p>This will permanently delete the folder and all its contents.</p>
              <div className="mt-4 flex gap-2">
                <button onClick={handleRemoveFolder} className="bg-red-700 text-white font-bold py-1 px-3 rounded-lg hover:bg-red-800 transition">
                  Yes, Delete
                </button>
                <button onClick={() => setIsConfirmingDelete(false)} className="bg-gray-300 text-gray-800 font-bold py-1 px-3 rounded-lg hover:bg-gray-400 transition">
                  Cancel
                </button>
              </div>
            </div>
          )}

          <hr className="border-gray-300" />
          
          <div className="flex flex-col items-center gap-4">
            <h2 className="text-xl font-bold text-green-800">Upload Photos & Videos</h2>
            <label 
              htmlFor="file-upload" 
              className={`upload-label bg-yellow-400 text-gray-900 font-bold py-3 px-6 rounded-full shadow-lg transition-all cursor-pointer ${
                !activeFolderId && 'opacity-50 pointer-events-none'
              }`}
            >
              Choose Files
            </label>
            <input 
              id="file-upload" 
              type="file" 
              multiple 
              accept="image/*,video/*" 
              className="hidden" 
              onChange={handleFileUpload} 
              disabled={!activeFolderId}
            />
            <p className="text-sm text-gray-600 text-center">
              {activeFolderId ? "Select one or more files from your device to add to this folder." : "Please select a folder first to enable uploads."}
            </p>
          </div>
        </section>

        {message && (
          <div className="bg-yellow-100 border border-yellow-400 text-yellow-700 px-4 py-3 rounded-lg relative my-4" role="alert">
            <span className="block sm:inline">{message}</span>
          </div>
        )}
        
        {userId && <p className="text-xs text-gray-400 mt-4 break-words text-center">User ID: {userId}</p>}
      </div>
    </div>
  );
};

export default App;