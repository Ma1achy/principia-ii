/**
 * Chazy The Voice
 *
 * Named after Jean Chazy (1882-1955), French astronomer and mathematician
 * who classified the final states of gravitational three-body systems.
 * 
 * This is Chazy's mind: an emotional state machine that reacts to what
 * you're doing in the simulation, building a personality over time.
 * 
 * Emotional States:
 * - NEUTRAL: Between all emotions, waiting, observing
 * - CURIOUS: Asking questions, probing, investigating
 * - ANALYTICAL: Focused, measuring, calculating
 * - AMUSED: Playful, sardonic, entertained by chaos
 * - CONCERNED: Worried about stability, boundaries
 * - CONTEMPLATIVE: Philosophical, existential, quiet
 * - EXCITED: Energized by discovery, patterns
 * - BORED: Impatient, wanting stimulation
 * - SURPRISED: Reacting to unexpected events
 * 
 * Intensity System:
 * - Intensity (0.1-1.0) represents emotional engagement level
 * - Low intensity: neutral, barely engaged, weak text bias
 * - High intensity: fully engaged, strong emotional text bias
 * - Intensity decays passively during idle, boosts on events
 * - Modulates text selection weights: effectiveWeight = 1.0 + (rawWeight - 1.0) * intensity
 */

export class ChazyMind {
  constructor() {
    // Random starting emotional state for session variety
    const startingEmotions = [
      { emotion: 'NEUTRAL',       intensity: [0.1, 0.4] },   // Low engagement
      { emotion: 'CURIOUS',       intensity: [0.4, 0.7] },   // Moderate interest
      { emotion: 'CONTEMPLATIVE', intensity: [0.3, 0.6] },   // Thoughtful
      { emotion: 'BORED',         intensity: [0.2, 0.4] },   // Understimulated
      { emotion: 'ANALYTICAL',    intensity: [0.4, 0.7] },   // Observing
    ];
    
    const startState = startingEmotions[Math.floor(Math.random() * startingEmotions.length)];
    const [minInt, maxInt] = startState.intensity;
    
    this.emotion = startState.emotion;
    this.intensity = minInt + Math.random() * (maxInt - minInt);
    
    console.log(`[Chazy] Session start: ${this.emotion}, intensity ${this.intensity.toFixed(2)}`);
    
    // State duration tracking
    this.emotionStartTime = Date.now();
    this.emotionDurationMs = 0;
    
    // Event memory (last 20 events)
    this.recentEvents = [];
    this.maxEventMemory = 20;
    
    // Text reflection tracking (for graph-based bidirectional feedback)
    this.lastTextReflection = Date.now();
    this.transitionPressure = 0; // Accumulates pressure to leave current state
    
    // Intensity decay tracking
    this.lastIntensityDecay = Date.now();
    this.intensityDecayInterval = 8000; // Decay check every 8s (was 5s - slower)
    this.intensityDecayRate = 0.015; // Lose 1.5% per check (was 2% - slower decay)
    this.intensityFloor = 0.1; // Never go below 10%
    
    // Personality traits (affect transition probabilities)
    this.traits = {
      curiosity: 0.7,      // How easily becomes curious
      patience: 0.4,       // Resistance to boredom
      playfulness: 0.6,    // Tendency toward amusement
      caution: 0.5,        // Tendency toward concern
      philosophy: 0.6,     // Drift toward contemplation
      coherence: 0.35,     // How much text selection influences graph traversal (0-1)
    };
    
    // Unified transition cooldown (applies to all transition pathways)
    this.nextTransitionAllowedAt = 0;
    this.minTransitionInterval = 15000; // Min 15s between emotion changes
    
    // Per-emotion pressure thresholds (emotional "mass")
    this.transitionThresholds = {
      NEUTRAL: 1.0,
      CURIOUS: 1.0,
      ANALYTICAL: 1.2,      // Sticky when analyzing
      AMUSED: 0.9,
      CONCERNED: 1.1,
      CONTEMPLATIVE: 1.3,   // Very resistant to leaving
      EXCITED: 0.85,        // Fast transitions
      BORED: 0.95,
      SURPRISED: 0.75,      // Very quick to transition
    };
    
    // Emotion graph: defines possible transitions and base weights
    this.emotionGraph = {
      NEUTRAL: {
        CURIOUS:       { base: 0.15 },
        ANALYTICAL:    { base: 0.15 },
        CONTEMPLATIVE: { base: 0.15 },
        CONCERNED:     { base: 0.15 },
        EXCITED:       { base: 0.10 },
        AMUSED:        { base: 0.10 },
        BORED:         { base: 0.10 },
        SURPRISED:     { base: 0.10 },
      },
      CURIOUS: {
        NEUTRAL:       { base: 0.05 },
        EXCITED:       { base: 0.4 },
        ANALYTICAL:    { base: 0.3 },
        CONTEMPLATIVE: { base: 0.2 },
        AMUSED:        { base: 0.1 },
      },
      EXCITED: {
        NEUTRAL:       { base: 0.05 },
        AMUSED:        { base: 0.35 },
        CURIOUS:       { base: 0.3  },
        SURPRISED:     { base: 0.25 },
        CONTEMPLATIVE: { base: 0.1  },
      },
      AMUSED: {
        NEUTRAL:       { base: 0.05 },
        CONTEMPLATIVE: { base: 0.4 },
        CURIOUS:       { base: 0.3 },
        BORED:         { base: 0.2 },
        ANALYTICAL:    { base: 0.1 },
      },
      CONTEMPLATIVE: {
        NEUTRAL:       { base: 0.05 },
        CURIOUS:       { base: 0.3 },
        ANALYTICAL:    { base: 0.3 },
        BORED:         { base: 0.25 },
        CONCERNED:     { base: 0.15 },
      },
      ANALYTICAL: {
        NEUTRAL:       { base: 0.05 },
        CONTEMPLATIVE: { base: 0.35 },
        CURIOUS:       { base: 0.3  },
        BORED:         { base: 0.2  },
        CONCERNED:     { base: 0.15 },
      },
      BORED: {
        NEUTRAL:       { base: 0.05 },
        CURIOUS:       { base: 0.4 },
        CONTEMPLATIVE: { base: 0.3 },
        ANALYTICAL:    { base: 0.2 },
        AMUSED:        { base: 0.1 },
      },
      CONCERNED: {
        NEUTRAL:       { base: 0.05 },
        ANALYTICAL:    { base: 0.35 },
        CONTEMPLATIVE: { base: 0.25 },
        CURIOUS:       { base: 0.2  },
        SURPRISED:     { base: 0.1  },
        AMUSED:        { base: 0.1  }, // Gallows humor - laughing at danger
      },
      SURPRISED: {
        NEUTRAL:       { base: 0.05 },
        CURIOUS:       { base: 0.35 },
        AMUSED:        { base: 0.3  },
        CONCERNED:     { base: 0.2  },
        EXCITED:       { base: 0.15 },
      },
    };
    
    // Mode preferences per emotion (affects text selection)
    this.emotionModeWeights = {
      NEUTRAL: { 
        'event': 1.0, 'phase': 1.0, 'diffusion': 1.0, 
        'stable': 1.0, 'collision': 1.0, 'ejection': 1.0,
        'idle': 1.2  // Slightly prefer idle when neutral
      },
      CURIOUS: { 'event': 2.0, 'phase': 1.5, 'diffusion': 1.2, 'stable': 0.8 },
      ANALYTICAL: { 'phase': 2.0, 'event': 1.5, 'stable': 1.3, 'diffusion': 0.9 },
      AMUSED: { 'diffusion': 2.0, 'event': 1.5, 'collision': 1.8, 'ejection': 1.6 },
      CONCERNED: { 'collision': 2.0, 'ejection': 1.8, 'event': 1.3, 'stable': 0.7 },
      CONTEMPLATIVE: { 'stable': 2.0, 'phase': 1.5, 'idle': 1.8, 'event': 0.8 },
      EXCITED: { 'event': 2.0, 'collision': 1.7, 'diffusion': 1.5, 'stable': 0.6 },
      BORED: { 'idle': 2.5, 'stable': 1.5, 'event': 0.5, 'diffusion': 0.6 },
      SURPRISED: { 'collision': 2.5, 'ejection': 2.0, 'event': 1.5, 'stable': 0.5 },
    };
  }
  
  /**
   * Record an event from the simulation
   * @param {string} eventType - Type of event (collision, ejection, zoom, drag, etc.)
   * @param {Object} data - Additional event data
   */
  observe(eventType, data = {}) {
    const event = {
      type: eventType,
      data,
      timestamp: Date.now(),
      emotion: this.emotion, // Emotion when event occurred
    };
    
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxEventMemory) {
      this.recentEvents.shift();
    }
    
    console.log(`[Chazy] Observed: ${eventType} | Current emotion: ${this.emotion}`);
    
    // Update intensity (passive decay)
    this._updateIntensity();
    
    // React to event (may trigger emotion change)
    this._react(event);
  }
  
  /**
   * React to an observed event (emotional state machine logic)
   */
  _react(event) {
    const now = Date.now();
    const timeSinceTransition = now - this.emotionStartTime;
    
    // Boost intensity for interesting events
    const intensityBoost = {
      'collision': 0.35,  // Strong boost (was 0.3)
      'ejection': 0.35,   // Strong boost (was 0.3)
      'stable': 0.12,     // Small boost (was 0.1)
      'zoom': 0.18,       // Medium boost (was 0.15)
      'drag': 0.18,       // Medium boost (was 0.15),
    };
    
    if (intensityBoost[event.type]) {
      this.intensity = Math.min(1.0, this.intensity + intensityBoost[event.type]);
      console.log(`[Chazy] Event ${event.type} boosts intensity -> ${this.intensity.toFixed(2)}`);
    }
    
    // Check unified transition cooldown
    if (now < this.nextTransitionAllowedAt) {
      const cooldownRemaining = (this.nextTransitionAllowedAt - now) / 1000;
      console.log(`[Chazy] Emotion locked (cooldown: ${cooldownRemaining.toFixed(1)}s)`);
      return;
    }
    
    // Event-driven emotion transitions
    const transitions = this._getTransitionsForEvent(event);
    
    if (transitions.length === 0) {
      // No strong reaction, check for time-based drift
      this._checkEmotionalDrift();
      return;
    }
    
    // Pick weighted random transition
    const newEmotion = this._weightedChoice(transitions);
    
    if (newEmotion && newEmotion !== this.emotion) {
      this._transitionTo(newEmotion, `reacting to ${event.type}`);
    }
  }
  
  /**
   * Get possible emotion transitions based on event type
   * @returns {Array} Array of {emotion, weight} objects
   */
  _getTransitionsForEvent(event) {
    const current = this.emotion;
    const type = event.type;
    const transitions = [];
    
    // Collision reactions
    if (type === 'collision') {
      if (current === 'CURIOUS' || current === 'ANALYTICAL') {
        transitions.push({ emotion: 'EXCITED', weight: 0.6 * this.traits.playfulness });
        transitions.push({ emotion: 'SURPRISED', weight: 0.4 });
      }
      if (current === 'CONTEMPLATIVE' || current === 'BORED') {
        transitions.push({ emotion: 'AMUSED', weight: 0.7 * this.traits.playfulness });
        transitions.push({ emotion: 'SURPRISED', weight: 0.3 });
      }
      if (current === 'EXCITED') {
        transitions.push({ emotion: 'AMUSED', weight: 0.5 });
      }
    }
    
    // Ejection reactions
    if (type === 'ejection') {
      if (current === 'CURIOUS' || current === 'ANALYTICAL') {
        transitions.push({ emotion: 'CONCERNED', weight: 0.6 * this.traits.caution });
        transitions.push({ emotion: 'SURPRISED', weight: 0.4 });
      }
      if (current === 'AMUSED') {
        transitions.push({ emotion: 'CONCERNED', weight: 0.5 * this.traits.caution });
        transitions.push({ emotion: 'CONTEMPLATIVE', weight: 0.3 });
      }
      if (current === 'EXCITED') {
        transitions.push({ emotion: 'SURPRISED', weight: 0.6 });
      }
    }
    
    // Stable orbit achieved
    if (type === 'stable') {
      if (current === 'CONCERNED') {
        transitions.push({ emotion: 'CONTEMPLATIVE', weight: 0.6 * this.traits.philosophy });
        transitions.push({ emotion: 'ANALYTICAL', weight: 0.4 });
      }
      if (current === 'EXCITED' || current === 'SURPRISED') {
        transitions.push({ emotion: 'CONTEMPLATIVE', weight: 0.5 * this.traits.philosophy });
      }
      if (current === 'AMUSED') {
        transitions.push({ emotion: 'BORED', weight: 0.3 * (1 - this.traits.patience) });
      }
    }
    
    // User interaction (zoom, drag)
    if (type === 'zoom' || type === 'drag') {
      if (current === 'BORED') {
        transitions.push({ emotion: 'CURIOUS', weight: 0.8 * this.traits.curiosity });
      }
      if (current === 'CONTEMPLATIVE') {
        transitions.push({ emotion: 'CURIOUS', weight: 0.4 * this.traits.curiosity });
      }
    }
    
    // Idle (no interaction)
    if (type === 'idle') {
      const idleDuration = event.data.duration || 0;
      if (idleDuration > 30000 && current !== 'BORED') {
        transitions.push({ emotion: 'BORED', weight: 0.6 * (1 - this.traits.patience) });
        transitions.push({ emotion: 'CONTEMPLATIVE', weight: 0.4 * this.traits.philosophy });
      }
    }
    
    return transitions;
  }
  
  /**
   * Check for time-based emotional drift (happens when no events)
   */
  _checkEmotionalDrift() {
    const now = Date.now();
    const timeInEmotion = now - this.emotionStartTime;
    
    // After 45s in same emotion, consider drift
    if (timeInEmotion < 45000) return;
    
    // Check unified transition cooldown
    if (now < this.nextTransitionAllowedAt) return;
    
    const current = this.emotion;
    const drifts = [];
    
    // High-energy states drift toward contemplation
    if (current === 'EXCITED' || current === 'SURPRISED') {
      drifts.push({ emotion: 'CONTEMPLATIVE', weight: 0.3 * this.traits.philosophy });
      drifts.push({ emotion: 'CURIOUS', weight: 0.2 * this.traits.curiosity });
    }
    
    // Concerned drifts toward analytical or contemplative
    if (current === 'CONCERNED') {
      drifts.push({ emotion: 'ANALYTICAL', weight: 0.3 });
      drifts.push({ emotion: 'CONTEMPLATIVE', weight: 0.2 * this.traits.philosophy });
    }
    
    // Amused drifts toward bored or curious
    if (current === 'AMUSED') {
      drifts.push({ emotion: 'BORED', weight: 0.2 * (1 - this.traits.patience) });
      drifts.push({ emotion: 'CURIOUS', weight: 0.2 * this.traits.curiosity });
    }
    
    // Contemplative very slowly drifts toward curious
    if (current === 'CONTEMPLATIVE' && timeInEmotion > 90000) {
      drifts.push({ emotion: 'CURIOUS', weight: 0.15 * this.traits.curiosity });
    }
    
    // Bored drifts toward curious if given time
    if (current === 'BORED' && timeInEmotion > 60000) {
      drifts.push({ emotion: 'CURIOUS', weight: 0.25 * this.traits.curiosity });
    }
    
    if (drifts.length > 0) {
      const newEmotion = this._weightedChoice(drifts);
      if (newEmotion && newEmotion !== this.emotion) {
        this._transitionTo(newEmotion, 'emotional drift');
      }
    }
  }
  
  /**
   * Transition to a new emotional state
   */
  _transitionTo(newEmotion, reason) {
    console.log(`[Chazy] ${this.emotion} -> ${newEmotion} (${reason})`);
    
    const oldEmotion = this.emotion;
    this.emotion = newEmotion;
    this.emotionStartTime = Date.now();
    
    // Set unified cooldown for all transition pathways
    this.nextTransitionAllowedAt = Date.now() + this.minTransitionInterval;
    
    // Set intensity based on new emotion
    if (newEmotion === 'NEUTRAL') {
      this.intensity = 0.2 + Math.random() * 0.2; // 0.2-0.4, low engagement
    } else if (newEmotion === 'SURPRISED' || newEmotion === 'EXCITED') {
      this.intensity = 0.8 + Math.random() * 0.2; // 0.8-1.0, high engagement
    } else if (newEmotion === 'CONTEMPLATIVE' || newEmotion === 'ANALYTICAL') {
      this.intensity = 0.4 + Math.random() * 0.3; // 0.4-0.7, moderate
    } else {
      this.intensity = 0.5 + Math.random() * 0.3; // 0.5-0.8, medium-high
    }
  }
  
  /**
   * Update intensity - passive decay during idle
   * Call this periodically (e.g., in observe() or before reflection)
   */
  _updateIntensity() {
    const now = Date.now();
    const timeSinceDecay = now - this.lastIntensityDecay;
    
    // Passive decay check every 8 seconds
    if (timeSinceDecay >= this.intensityDecayInterval) {
      this.lastIntensityDecay = now;
      
      // Passive decay (idle drains engagement)
      this.intensity = Math.max(
        this.intensityFloor,
        this.intensity - this.intensityDecayRate
      );
      
      console.log(`[Chazy] Intensity decay -> ${this.intensity.toFixed(2)}`);
    }
    
    // Check fade-to-neutral every time (more responsive than decay gate)
    if (this.intensity <= 0.12 && this.emotion !== 'NEUTRAL') {
      const timeInEmotion = now - this.emotionStartTime;
      // After 45s at low intensity, drift to neutral
      if (timeInEmotion > 45000 && now >= this.nextTransitionAllowedAt) {
        console.log(`[Chazy] Low intensity drift -> NEUTRAL`);
        this._transitionTo('NEUTRAL', 'low engagement fade');
      }
    }
  }
  
  /**
   * Weighted random choice from array of {emotion, weight} objects
   */
  _weightedChoice(choices) {
    const totalWeight = choices.reduce((sum, c) => sum + c.weight, 0);
    if (totalWeight === 0) return null;
    
    let rand = Math.random() * totalWeight;
    for (const choice of choices) {
      rand -= choice.weight;
      if (rand <= 0) return choice.emotion;
    }
    
    return choices[choices.length - 1].emotion;
  }
  
  /**
   * Get current emotional state
   * @returns {Object} { emotion, intensity, duration }
   */
  getState() {
    return {
      emotion: this.emotion,
      intensity: this.intensity,
      duration: Date.now() - this.emotionStartTime,
    };
  }
  
  /**
   * Adjust mode selection weight based on current emotion
   * @param {string} mode - Render mode or interaction mode
   * @returns {number} Weight multiplier (0.5-2.5)
   */
  getModeWeight(mode) {
    const weights = this.emotionModeWeights[this.emotion] || {};
    return weights[mode] || 1.0;
  }
  
  /**
   * Get theme preferences based on current emotion
   * @returns {Array<string>} Preferred themes
   */
  getPreferredThemes() {
    const themeMap = {
      NEUTRAL: ['observation', 'waiting', 'presence'],
      CURIOUS: ['boundary', 'chaos', 'dance'],
      ANALYTICAL: ['phase', 'computation', 'precision'],
      AMUSED: ['chaos', 'dance', 'paradox'],
      CONCERNED: ['boundary', 'escape', 'dissolution'],
      CONTEMPLATIVE: ['time', 'existence', 'void'],
      EXCITED: ['discovery', 'pattern', 'resonance'],
      BORED: ['waiting', 'stillness', 'patience'],
      SURPRISED: ['chaos', 'unexpected', 'emergence'],
    };
    
    return themeMap[this.emotion] || [];
  }
  
  /**
   * Should Chazy interrupt current text to react?
   * Returns true if event is emotionally significant
   */
  shouldInterrupt(eventType) {
    // Only interrupt for high-impact events
    const interruptEvents = ['collision', 'ejection'];
    if (!interruptEvents.includes(eventType)) {
      return false;
    }
    
    // Higher intensity = more likely to interrupt
    const interruptChance = this.intensity * 0.4; // Max 40% chance
    return Math.random() < interruptChance;
  }
  
  /**
   * Reflect on selected text - traverses the emotion graph
   * This is the bidirectional feedback: what Chazy says influences where she goes next
   * 
   * The message's emotional weights modulate the edge weights from current state
   * Creates emergent behavior - saying amused things guides toward contemplation,
   * not just more amusement
   * 
   * @param {Object} textData - Text data object from selection (contains reflect_pull, weights, etc.)
   * @param {Array} themes - Themes of selected text
   */
  reflectOnText(textData = {}, themes = []) {
    const now = Date.now();
    const timeSinceLastReflection = now - this.lastTextReflection;
    
    // Only reflect every 3+ seconds to prevent feedback noise
    if (timeSinceLastReflection < 3000) return;
    this.lastTextReflection = now;
    
    const timeInEmotion = now - this.emotionStartTime;
    
    // Minimum dwell time: 20s before text can drive transitions
    // This keeps emotional transitions slow and tidal even with graph complexity
    if (timeInEmotion < 20000) return;
    
    // Coherence trait controls how much text influences graph traversal
    const influence = this.traits.coherence; // 0.35 = 35% influence
    
    // Extract reflect_pull, fallback to weights for backwards compat
    const reflectPull = textData.reflect_pull || textData.weights || {};
    
    // Accumulate pressure to leave current state
    // Each reflection adds pressure based on how "strong" the message was
    const totalWeight = Object.values(reflectPull).reduce((sum, w) => sum + w, 0);
    const avgWeight = totalWeight / Math.max(Object.keys(reflectPull).length, 1);
    
    // High intensity = faster pressure build (engaged states transition sooner if conversation is "hot")
    const intensityMultiplier = 1.0 + (0.3 * this.intensity); // 1.0x at intensity 0, 1.3x at intensity 1.0
    let pressureIncrease = influence * (avgWeight / 3.0) * intensityMultiplier;
    
    // Add random noise to prevent perfectly predictable transitions
    const randomNoise = (Math.random() - 0.5) * 0.1; // ±0.05
    pressureIncrease += randomNoise;
    
    this.transitionPressure += pressureIncrease;
    
    // Decay pressure slowly (prevents instant transitions)
    // High intensity slows decay (strong moods linger longer)
    // Low intensity accelerates decay (disengaged states shift more easily)
    const intensityDecayFactor = 1.0 - (0.2 * this.intensity); // 1.0x at intensity 0, 0.8x at intensity 1.0
    this.transitionPressure *= (0.97 * intensityDecayFactor); // Base 3% decay, adjusted by intensity
    
    // Clamp pressure to non-negative (makes tuning easier)
    this.transitionPressure = Math.max(0, this.transitionPressure);
    
    // Adjust intensity based on message strength
    // Strong messages increase engagement, weak messages decrease it
    const intensityTarget = avgWeight / 3.5; // Map [0-3.5] -> [0-1.0]
    const intensityDrift = (intensityTarget - this.intensity) * 0.15; // 15% pull
    
    this.intensity = Math.max(
      this.intensityFloor,
      Math.min(1.0, this.intensity + intensityDrift)
    );
    
    console.log(`[Chazy] Reflecting on text (avg weight: ${avgWeight.toFixed(1)}), pressure: ${this.transitionPressure.toFixed(2)}, intensity: ${this.intensity.toFixed(2)} (target: ${intensityTarget.toFixed(2)})`);
    
    // Check unified transition cooldown
    const now2 = Date.now();
    if (now2 < this.nextTransitionAllowedAt) {
      return;
    }
    
    // Use per-emotion threshold (emotional "mass")
    const threshold = this.transitionThresholds[this.emotion] || 1.0;
    
    // Threshold reached - time to traverse the graph
    if (this.transitionPressure >= threshold) {
      const edges = this.emotionGraph[this.emotion];
      
      if (!edges || Object.keys(edges).length === 0) {
        console.log(`[Chazy] No edges from ${this.emotion}, staying put`);
        this.transitionPressure = 0;
        return;
      }
      
      // Normalize reflectPull keys to lowercase for safe lookup
      const normalizedWeights = Object.fromEntries(
        Object.entries(reflectPull).map(([k, v]) => [k.toLowerCase(), v])
      );
      
      // Modulate edge weights based on selected message's emotional content
      const modulatedEdges = {};
      for (const [targetEmotion, edge] of Object.entries(edges)) {
        // Message weight for target emotion pulls that edge stronger
        const pull = normalizedWeights[targetEmotion.toLowerCase()] ?? 1.0;
        let modulatedWeight = edge.base * pull;
        
        // Make return-to-NEUTRAL harder when highly engaged
        // At high intensity (0.9+), reduce NEUTRAL edge strength to 0.02-0.03
        // At low intensity (0.1), keep full strength (easier to fade)
        if (targetEmotion === 'NEUTRAL') {
          const neutralReduction = this.intensity * 0.5; // 0 at intensity 0, 0.5 at intensity 1.0
          modulatedWeight *= (1.0 - neutralReduction); // Reduces by up to 50% at max intensity
        }
        
        modulatedEdges[targetEmotion] = modulatedWeight;
      }
      
      console.log(`[Chazy] Modulated edges from ${this.emotion}:`, 
        Object.entries(modulatedEdges)
          .map(([e, w]) => `${e}=${w.toFixed(2)}`)
          .join(', ')
      );
      
      // Random kick: 15% chance to ignore graph and pick random emotion
      if (Math.random() < 0.15) {
        const allEmotions = Object.keys(this.emotionGraph);
        const kickEmotion = allEmotions[Math.floor(Math.random() * allEmotions.length)];
        if (kickEmotion !== this.emotion) {
          console.log(`[Chazy] Random kick! ${this.emotion} -> ${kickEmotion} (ignoring graph)`);
          this._transitionTo(kickEmotion, 'random perturbation');
          this.transitionPressure = 0;
          return;
        }
      }
      
      // Weighted sample from modulated edges
      // Convert object to array format expected by _weightedChoice
      const choicesArray = Object.entries(modulatedEdges).map(([emotion, weight]) => ({
        emotion,
        weight
      }));
      const nextEmotion = this._weightedChoice(choicesArray);
      
      if (nextEmotion && nextEmotion !== this.emotion) {
        const topThemes = themes.slice(0, 2).join(', ');
        console.log(`[Chazy] Graph traversal: ${this.emotion} -> ${nextEmotion} (following ${topThemes || 'momentum'})`);
        this._transitionTo(nextEmotion, `graph traversal via ${topThemes || 'text momentum'}`);
        this.transitionPressure = 0; // Reset after transition
      } else {
        // Sampled ourselves (no edge or stayed put), decay pressure faster
        this.transitionPressure *= 0.5;
      }
    }
  }
  
  /**
   * Get a summary of recent activity for context
   * @returns {string} Summary description
   */
  getRecentActivitySummary() {
    const recentTypes = this.recentEvents
      .slice(-5)
      .map(e => e.type);
    
    const collisionCount = recentTypes.filter(t => t === 'collision').length;
    const ejectionCount = recentTypes.filter(t => t === 'ejection').length;
    const idleCount = recentTypes.filter(t => t === 'idle').length;
    
    if (collisionCount >= 3) return 'frequent collisions';
    if (ejectionCount >= 2) return 'multiple ejections';
    if (idleCount >= 3) return 'extended idleness';
    if (recentTypes.length === 0) return 'just started';
    
    return 'mixed activity';
  }
}