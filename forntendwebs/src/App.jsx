import React, { useState, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import TypingDots from './components/TypingDots'

export default function App() {
  // — UI state
  const [input, setInput] = useState('')
  const [chat, setChat] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [typingText, setTypingText] = useState('')
  // State to track sidebar visibility, updated by the Sidebar component
  const [isSidebarActuallyOpen, setIsSidebarActuallyOpen] = useState(window.innerWidth >= 768);


  // — Ensure we have a user_id
  useEffect(() => {
    if (!localStorage.getItem('user_id')) {
      localStorage.setItem('user_id', 'user-' + Date.now())
    }
  }, [])

  /**
   * Helper function for fetching data with exponential backoff for retries.
   * @param {string} url - The URL to fetch.
   * @param {object} options - Fetch options (method, headers, body, etc.).
   * @param {number} retries - Current retry count.
   */
  const fetchDataWithBackoff = async (url, options, retries = 0) => {
    const maxRetries = 3;
    const initialDelay = 1000; // 1 second initial delay

    while (retries < maxRetries) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) {
          // If a "Too Many Requests" error (429) occurs, apply backoff and retry
          if (res.status === 429) { 
            const delay = initialDelay * Math.pow(2, retries) + Math.random() * 1000; // Exponential backoff with jitter
            console.warn(`Rate limit hit for ${url}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            retries++;
            continue; // Skip to the next iteration of the while loop to retry
          }
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res; // Successfully fetched, return the response
      } catch (error) {
        console.error(`Failed to fetch ${url} (attempt ${retries + 1}/${maxRetries}):`, error);
        if (retries === maxRetries - 1) {
          throw error; // If it's the last retry attempt, re-throw the error
        }
        const delay = initialDelay * Math.pow(2, retries) + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        retries++;
      }
    }
    // This line should technically not be reached if maxRetries is > 0 and throws on last retry.
    // Added for completeness to satisfy strict linters if any.
    throw new Error("Max retries exceeded for fetch operation.");
  };

  // 🚀 1. AUTO‑SELECT or CREATE a session on mount
  useEffect(() => {
    const userId = localStorage.getItem('user_id')
    if (!userId) return

    fetchDataWithBackoff('http://localhost:5000/api/sessions', {
      headers: { 'X-User-Id': userId }
    })
      .then(res => res.json())
      .then(sessions => {
        if (sessions.length) {
          setSessionId(sessions[0]._id)
        } else {
          // no sessions → create one
          return fetchDataWithBackoff('http://localhost:5000/api/sessions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-Id': userId
            },
            body: JSON.stringify({ title: 'First Chat' })
          })
            .then(res => res.json())
            .then(newSess => setSessionId(newSess._id))
        }
      })
      .catch(error => console.error("Error during session auto-selection/creation:", error))
  }, [])

  // 📥 2. LOAD full history whenever sessionId changes
  useEffect(() => {
    const userId = localStorage.getItem('user_id')
    if (!sessionId || !userId) return

    fetchDataWithBackoff(`http://localhost:5000/api/sessions/${sessionId}/messages`, {
      headers: { 'X-User-Id': userId }
    })
      .then(res => res.json())
      .then(msgs => setChat(msgs))
      .catch(error => console.error("Error loading chat history:", error))
  }, [sessionId])

  // — sendPrompt: save user, call Gemini, save & display bot
  const sendPrompt = async () => {
    const text = input.trim()
    const userId = localStorage.getItem('user_id')
    if (!text || !sessionId || !userId) return

    setIsLoading(true)

    try {
      // 1️⃣ Save user message
      await fetchDataWithBackoff(
        `http://localhost:5000/api/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId
          },
          body: JSON.stringify({ role: 'user', text })
        }
      )

      // 2️⃣ Call Gemini
      const gemRes = await fetchDataWithBackoff('http://localhost:5000/api/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId
        },
        body: JSON.stringify({ prompt: text })
      })
      const { text: reply } = await gemRes.json()

      // 3️⃣ Save bot reply
      await fetchDataWithBackoff(
        `http://localhost:5000/api/sessions/${sessionId}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-Id': userId
          },
          body: JSON.stringify({ role: 'bot', text: reply })
        }
      )

      // 4️⃣ Typing effect then render both
      setTypingText('')
      let idx = 0
      const interval = setInterval(() => {
        if (idx < reply.length) {
          setTypingText(prev => prev + reply[idx])
          idx++
        } else {
          clearInterval(interval)
          setChat(prev => [
            ...prev,
            { role: 'user', text },
            { role: 'bot', text: reply }
          ])
          setTypingText('')
          setIsLoading(false)
        }
      }, 20)

      setInput('')
    } catch (error) {
      console.error("Error sending prompt or receiving Gemini reply:", error);
      setIsLoading(false); // Ensure loading state is reset on error
      // Optionally, add user-facing error message here
    }
  }

  // — speak via Deepgram TTS
  const speak = async message => {
    const userId = localStorage.getItem('user_id')
    try {
      const res = await fetchDataWithBackoff('http://localhost:5000/api/speak', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId
        },
        body: JSON.stringify({ text: message })
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      new Audio(url).play()
    } catch (err) {
      console.error('TTS error:', err)
    }
  }

  return (
    <div className="flex h-screen">
      {/* The Sidebar component */}
      <Sidebar
        onSelectSession={setSessionId}
        selected={sessionId}
        // This prop allows Sidebar to tell App.jsx its current open/closed state
        onToggleSidebar={setIsSidebarActuallyOpen} 
      />

      {/* Main content area, whose left margin adjusts based on sidebar visibility */}
      <div className={`
        flex-1 flex flex-col p-4  
        transition-all duration-300 ease-in-out
        ${isSidebarActuallyOpen ? 'ml-64 md:ml-64' : 'ml-0'} /* Add ml-64 when sidebar is open, 
                                                                 else ml-0. md:ml-64 keeps it fixed on desktop */
        `}>
        {/* Chat history */}
        <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
          {chat.map((msg, i) => (
            <div
              key={i}
              className={`p-3 rounded ${
                msg.role === 'user'
                  ? 'bg-blue-100'
                  : 'bg-gray-100'
              }`}
            >
              <p className="mb-1 font-semibold">
                {msg.role === 'user' ? 'You' : 'Gemini'}
              </p>
              <p>{msg.text}</p>
              {msg.role === 'bot' && (
                <button
                  className="mt-2 text-sm text-blue-500 hover:underline"
                  onClick={() => speak(msg.text)}
                >
                  🔊 Speak
                </button>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="p-3 rounded bg-gray-100">
              <p className="mb-1 font-semibold">
                Gemini
              </p>
              <p>{typingText}</p>
              <TypingDots />
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e =>
              e.key === 'Enter' && sendPrompt()
            }
            disabled={!sessionId}
            className="flex-1 p-2 border rounded"
            placeholder="Ask about computer networks..."
          />
          <button
            onClick={sendPrompt}
            disabled={isLoading || !sessionId}
            className="bg-blue-500 text-white px-4 py-2 rounded"
          >
            {isLoading ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
