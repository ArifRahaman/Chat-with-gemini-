import React, { useEffect, useState } from 'react';

export default function Sidebar({ onSelectSession, selected }) {
  const [sessions, setSessions] = useState([]);
  // State for sidebar visibility: open by default on screens >= 768px, closed otherwise
  const [isSidebarOpen, setIsSidebarOpen] = useState(window.innerWidth >= 768); 
  
  // In a real application, userId management might be handled through a more secure authentication context.
  const userId = localStorage.getItem('user_id');

  /**
   * Fetches chat sessions from the API with exponential backoff for retries.
   */
  const fetchSessions = async () => {
    let retries = 0;
    const maxRetries = 3;
    const initialDelay = 1000; // 1 second initial delay

    while (retries < maxRetries) {
      try {
        const res = await fetch('http://localhost:5000/api/sessions', {
          headers: { 'X-User-Id': userId }
        });

        if (!res.ok) {
          // If a "Too Many Requests" error (429) occurs, apply backoff and retry
          if (res.status === 429) { 
            const delay = initialDelay * Math.pow(2, retries) + Math.random() * 1000; // Exponential backoff with jitter
            console.warn(`Rate limit hit while fetching sessions, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            retries++;
            continue; // Skip to the next iteration of the while loop to retry
          }
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        setSessions(await res.json());
        return; // Successfully fetched, exit the function
      } catch (error) {
        console.error(`Failed to fetch sessions (attempt ${retries + 1}/${maxRetries}):`, error);
        if (retries === maxRetries - 1) {
          // If it's the last retry attempt, re-throw the error
          throw error;
        }
        const delay = initialDelay * Math.pow(2, retries) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }
  };

  /**
   * Creates a new chat session via API call with exponential backoff.
   */
  const createSession = async () => {
    let retries = 0;
    const maxRetries = 3;
    const initialDelay = 1000;

    while (retries < maxRetries) {
      try {
        const res = await fetch('http://localhost:5000/api/sessions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId,
          },
          body: JSON.stringify({ title: 'Chat ' + new Date().toLocaleTimeString() })
        });

        if (!res.ok) {
          if (res.status === 429) {
            const delay = initialDelay * Math.pow(2, retries) + Math.random() * 1000;
            console.warn(`Rate limit hit while creating session, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            retries++;
            continue;
          }
          throw new Error(`HTTP error! status: ${res.status}`);
        }

        const sess = await res.json();
        setSessions([sess, ...sessions]);
        onSelectSession(sess._id);
        // On smaller screens, automatically close the sidebar after creating a new session
        if (window.innerWidth < 768) {
          setIsSidebarOpen(false);
        }
        return; // Success, exit function
      } catch (error) {
        console.error(`Failed to create session (attempt ${retries + 1}/${maxRetries}):`, error);
        if (retries === maxRetries - 1) {
          throw error;
        }
        const delay = initialDelay * Math.pow(2, retries) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }
  };

  useEffect(() => {
    fetchSessions();

    // Event listener for window resize to adjust sidebar visibility responsively
    const handleResize = () => {
      // Set sidebar open on desktop (>=768px), and closed on mobile (<768px)
      setIsSidebarOpen(window.innerWidth >= 768);
    };

    window.addEventListener('resize', handleResize);
    // Clean up the event listener when the component unmounts
    return () => window.removeEventListener('resize', handleResize);
  }, []); // Empty dependency array means this effect runs once on mount and cleans up on unmount

  /**
   * Toggles the visibility state of the sidebar.
   */
  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <>
      {/* Sidebar Container: Fixed position to slide in/out without affecting main content flow */}
      <div className={`
        fixed top-0 left-0 h-screen bg-gray-50 border-r z-50 
        transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0 w-64' : '-translate-x-full w-64'}
        `}>
        {/* Inner Sidebar Content */}
        <div className="h-full flex flex-col p-4">
          <button
            onClick={createSession}
            className="w-full mb-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 transition-colors shadow-sm"
          >
            + New Chat
          </button>

          <ul className="flex-grow overflow-y-auto">
            {sessions.map(s => (
              <li
                key={s._id}
                onClick={() => {
                  onSelectSession(s._id);
                  // On smaller screens, automatically close sidebar after selecting a session
                  if (window.innerWidth < 768) {
                    setIsSidebarOpen(false);
                  }
                }}
                className={`p-2 mb-1 rounded-md cursor-pointer text-sm md:text-base 
                            ${selected === s._id ? 'bg-blue-200 text-blue-800 font-semibold' : 'hover:bg-gray-200'}
                            transition-colors`}
              >
                {s.title}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Toggle Button: Positioned next to the sidebar, always visible */}
      <button
        onClick={toggleSidebar}
        className={`
          fixed top-4 z-50 p-2 bg-blue-500 text-white rounded-full shadow-md 
          hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50
          transition-all duration-300 ease-in-out
          ${isSidebarOpen ? 'left-64 ml-2' : 'left-0 ml-2'} /* Adjusts position based on sidebar visibility */
          `}>
        {isSidebarOpen ? (
          // Icon for 'Hide Sidebar' (X or close arrow)
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414L7.5 9.086l-1.793-1.793a1 1 0 00-1.414 1.414L6.086 10l-1.793 1.793a1 1 0 101.414 1.414L7.5 10.914l1.793 1.793a1 1 0 001.414-1.414L8.914 10l1.793-1.793z" clipRule="evenodd" />
          </svg>
        ) : (
          // Icon for 'Show Sidebar' (Hamburger or open arrow)
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-11a1 1 0 10-2 0v4a1 1 0 001 1h3a1 1 0 100-2H9V7z" clipRule="evenodd" />
          </svg>
        )}
      </button>
      
      {/* Overlay: Appears only on small screens when sidebar is open, to close it by clicking outside */}
      {isSidebarOpen && window.innerWidth < 768 && (
        <div 
          className="fixed inset-0 bg-black opacity-50 z-40" 
          onClick={toggleSidebar}
        ></div>
      )}
    </>
  );
}