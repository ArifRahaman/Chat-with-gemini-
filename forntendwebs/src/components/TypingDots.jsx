// src/components/TypingDots.jsx
import React, { useState, useEffect } from 'react'

export default function TypingDots({ message = 'Gemini is typing' }) {
  const [dots, setDots] = useState('')

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => (prev.length < 3 ? prev + '.' : ''))
    }, 500)
    return () => clearInterval(interval)
  }, [])

  return (
    <p className="italic text-gray-500 mt-2">
      {message}
      <span>{dots}</span>
    </p>
  )
}
