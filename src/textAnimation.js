/**
 * Animated text effects for subtitle display
 */

// Character pool for scrambling animation
const CHAR_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-=+[]{}|;:,.<>?/~';

/**
 * Animates text with cascade scramble effect
 * @param {HTMLElement} element - Target element
 * @param {string} targetText - Final text to display
 * @param {number} preCalculatedWidth - Pre-calculated width from fitTitle adjustments
 * @param {Function} onComplete - Callback when animation finishes
 * @param {Object} options - Animation options
 */
export function animateTextIn(element, targetText, preCalculatedWidth, onComplete, options = {}) {
  const {
    cascadeDelay = 30,      // ms between starting each character
    cycleDuration = 250,    // ms each character cycles before locking
    cycleSpeed = 35,        // ms per random character change
  } = options;

  // Measure cursor width
  const tempCursor = document.createElement('span');
  tempCursor.className = 'text-cursor';
  tempCursor.textContent = '█';
  tempCursor.style.visibility = 'hidden';
  tempCursor.style.position = 'absolute';
  element.parentElement.appendChild(tempCursor);
  const cursorWidth = tempCursor.getBoundingClientRect().width;
  tempCursor.remove();
  
  // Use pre-calculated text width + cursor width
  const finalWidth = preCalculatedWidth + cursorWidth;
  element.style.minWidth = `${finalWidth}px`;
  
  // Create cursor element (no blinking during typing)
  const cursor = document.createElement('span');
  cursor.className = 'text-cursor'; // No blinking class yet
  cursor.textContent = '█';
  
  // Clear element and add cursor
  element.textContent = '';
  element.appendChild(cursor);
  
  const chars = targetText.split('');
  const charSpans = [];
  let completedChars = 0;
  
  // Create span for each character
  chars.forEach(() => {
    const span = document.createElement('span');
    span.textContent = '';
    span.style.opacity = '0';
    element.insertBefore(span, cursor);
    charSpans.push(span);
  });
  
  // Animate each character
  chars.forEach((targetChar, index) => {
    const span = charSpans[index];
    
    // Add random variation to cascade timing (±30% variation)
    const randomizedDelay = cascadeDelay * (0.7 + Math.random() * 0.6);
    const startTime = Date.now() + (index * randomizedDelay);
    
    // Add random variation to cycle duration (±20% variation)
    const randomizedDuration = cycleDuration * (0.8 + Math.random() * 0.4);
    const endTime = startTime + randomizedDuration;
    
    function animate() {
      const now = Date.now();
      
      if (now < startTime) {
        // Not started yet
        requestAnimationFrame(animate);
        return;
      }
      
      if (now >= endTime) {
        // Lock in final character
        span.textContent = targetChar;
        span.style.opacity = '1';
        completedChars++;
        
        // Keep cursor at end, start blinking when all done
        if (completedChars === chars.length) {
          setTimeout(() => {
            cursor.classList.add('blinking'); // Start blinking
            // DON'T clear minWidth - keep it to prevent shrinking
            // element.style.minWidth = '';
            if (onComplete) onComplete();
          }, 200);
        }
        return;
      }
      
      // Show random character
      span.style.opacity = '1';
      span.textContent = CHAR_POOL[Math.floor(Math.random() * CHAR_POOL.length)];
      
      setTimeout(() => requestAnimationFrame(animate), cycleSpeed);
    }
    
    requestAnimationFrame(animate);
  });
}

/**
 * Animates text out with cursor delete effect
 * @param {HTMLElement} element - Target element
 * @param {Function} onComplete - Callback when animation finishes
 * @param {Object} options - Animation options
 */
export function animateTextOut(element, onComplete, options = {}) {
  const {
    deleteDelay = 40,  // ms between deleting each character
  } = options;
  
  // Get current text (handle both plain text and existing spans)
  let text = '';
  let existingSpans = [];
  
  // Check if element has child nodes (from previous animation)
  Array.from(element.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent;
    } else if (node.nodeName === 'SPAN' && !node.classList.contains('text-cursor')) {
      text += node.textContent;
      existingSpans.push(node);
    }
  });
  
  // If no text, just complete immediately
  if (text.length === 0) {
    // Clear minWidth before next text
    element.style.minWidth = '';
    if (onComplete) onComplete();
    return;
  }
  
  const chars = text.split('');
  
  // Find existing cursor or create new one
  let cursor = element.querySelector('.text-cursor');
  if (!cursor) {
    cursor = document.createElement('span');
    cursor.className = 'text-cursor';
    cursor.textContent = '█';
  }
  
  // Stop cursor blinking during deletion
  cursor.classList.remove('blinking');
  
  // Clear and rebuild with spans
  element.textContent = '';
  const charSpans = chars.map(char => {
    const span = document.createElement('span');
    span.textContent = char;
    element.appendChild(span);
    return span;
  });
  element.appendChild(cursor);
  
  // Delete characters one by one from right to left
  let currentIndex = chars.length - 1;
  
  function deleteNext() {
    if (currentIndex < 0) {
      // All deleted, remove cursor and clear minWidth
      cursor.remove();
      element.style.minWidth = '';
      if (onComplete) onComplete();
      return;
    }
    
    // Remove character
    charSpans[currentIndex].remove();
    currentIndex--;
    
    setTimeout(deleteNext, deleteDelay);
  }
  
  // Start deleting after brief pause
  setTimeout(deleteNext, 100);
}
