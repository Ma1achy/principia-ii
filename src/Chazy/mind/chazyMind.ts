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

// ─── Types ─────────────────────────────────────────────────────────────────

type Emotion = 
  | 'NEUTRAL'
  | 'CURIOUS'
  | 'ANALYTICAL'
  | 'AMUSED'
  | 'CONCERNED'
  | 'CONTEMPLATIVE'
  | 'EXCITED'
  | 'BORED'
  | 'SURPRISED';

interface EmotionState {
  emotion: Emotion;
  intensity: number;
  duration: number;
}

interface EventRecord {
  type: string;
  data: Record<string, any>;
  timestamp: number;
  emotion: Emotion;
}

interface EmotionTransition {
  emotion: Emotion;
  weight: number;
}

interface EdgeDefinition {
  base: number;
}

interface Traits {
  curiosity: number;
  patience: number;
  playfulness: number;
  caution: number;
  philosophy: number;
  coherence: number;
}

interface TextData {
  reflect_pull?: Record<string, number>;
  weights?: Record<string, number>;
}

// ─── ChazyMind Class ───────────────────────────────────────────────────────

export class ChazyMind {
  emotion: Emotion;
  intensity: number;
  emotionStartTime: number;
  emotionDurationMs: number;
  recentEvents: EventRecord[];
  maxEventMemory: number;
  lastTextReflection: number;
  transitionPressure: number;
  lastIntensityDecay: number;
  intensityDecayInterval: number;
  intensityDecayRate: number;
  intensityFloor: number;
  traits: Traits;
  nextTransitionAllowedAt: number;
  minTransitionInterval: number;
  transitionThresholds: Record<Emotion, number>;
  emotionGraph: Record<Emotion, Partial<Record<Emotion, EdgeDefinition>>>;
  emotionModeWeights: Record<Emotion, Record<string, number>>;
  
  constructor() {
    // Random starting emotional state for session variety
    const startingEmotions: Array<{ emotion: Emotion; intensity: [number, number] }> = [
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
    this.transitionPressure = 0;
    
    // Intensity decay tracking
    this.lastIntensityDecay = Date.now();
    this.intensityDecayInterval = 8000;
    this.intensityDecayRate = 0.015;
    this.intensityFloor = 0.1;
    
    // Personality traits (affect transition probabilities)
    this.traits = {
      curiosity: 0.7,
      patience: 0.4,
      playfulness: 0.6,
      caution: 0.5,
      philosophy: 0.6,
      coherence: 0.35,
    };
    
    // Unified transition cooldown (applies to all transition pathways)
    this.nextTransitionAllowedAt = 0;
    this.minTransitionInterval = 15000;
    
    // Per-emotion pressure thresholds (emotional "mass")
    this.transitionThresholds = {
      NEUTRAL: 1.0,
      CURIOUS: 1.0,
      ANALYTICAL: 1.2,
      AMUSED: 0.9,
      CONCERNED: 1.1,
      CONTEMPLATIVE: 1.3,
      EXCITED: 0.85,
      BORED: 0.95,
      SURPRISED: 0.75,
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
        AMUSED:        { base: 0.1  },
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
        'idle': 1.2
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
   */
  observe(eventType: string, data: Record<string, any> = {}): void {
    if (!eventType || typeof eventType !== 'string') {
      console.warn('[ChazyMind] Invalid eventType:', eventType);
      return;
    }
    
    const event: EventRecord = {
      type: eventType,
      data: data || {},
      timestamp: Date.now(),
      emotion: this.emotion,
    };
    
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.maxEventMemory) {
      this.recentEvents.shift();
    }
    
    console.log(`[Chazy] Observed: ${eventType} | Current emotion: ${this.emotion}`);
    
    this._updateIntensity();
    this._react(event);
  }
  
  /**
   * React to an observed event (emotional state machine logic)
   */
  private _react(event: EventRecord): void {
    const now = Date.now();
    const timeSinceTransition = now - this.emotionStartTime;
    
    // Boost intensity for interesting events
    const intensityBoost: Record<string, number> = {
      'collision': 0.35,
      'ejection': 0.35,
      'stable': 0.12,
      'zoom': 0.18,
      'drag': 0.18,
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
   */
  private _getTransitionsForEvent(event: EventRecord): EmotionTransition[] {
    const current = this.emotion;
    const type = event.type;
    const transitions: EmotionTransition[] = [];
    
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
    
    // Immediate response (self-observation)
    if (type === 'immediate_response') {
      const { tone, wasSuccessful } = event.data;
      
      if (wasSuccessful) {
        if (tone === 'wry' || tone === 'playful') {
          if (current === 'ANALYTICAL' || current === 'CONTEMPLATIVE') {
            transitions.push({ emotion: 'AMUSED', weight: 0.5 * this.traits.playfulness });
          }
        }
        
        if (tone === 'concerned' || tone === 'ominous') {
          if (current === 'CURIOUS' || current === 'AMUSED') {
            transitions.push({ emotion: 'CONCERNED', weight: 0.4 * this.traits.caution });
          }
        }
        
        if (tone === 'surprised') {
          if (current !== 'SURPRISED') {
            transitions.push({ emotion: 'SURPRISED', weight: 0.3 });
          }
        }
        
        this.intensity = Math.min(1.0, this.intensity + 0.08);
      }
    }
    
    return transitions;
  }
  
  /**
   * Check for time-based emotional drift (happens when no events)
   */
  private _checkEmotionalDrift(): void {
    const now = Date.now();
    const timeInEmotion = now - this.emotionStartTime;
    
    if (timeInEmotion < 45000) return;
    
    if (now < this.nextTransitionAllowedAt) return;
    
    const current = this.emotion;
    const drifts: EmotionTransition[] = [];
    
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
  private _transitionTo(newEmotion: Emotion, reason: string): void {
    console.log(`[Chazy] ${this.emotion} -> ${newEmotion} (${reason})`);
    
    const oldEmotion = this.emotion;
    this.emotion = newEmotion;
    this.emotionStartTime = Date.now();
    
    this.nextTransitionAllowedAt = Date.now() + this.minTransitionInterval;
    
    if (this._shouldExpressTransition(oldEmotion, newEmotion)) {
      this._requestImmediateAmbient(`transition_${newEmotion.toLowerCase()}`);
    }
    
    // Set intensity based on new emotion
    if (newEmotion === 'NEUTRAL') {
      this.intensity = 0.2 + Math.random() * 0.2;
    } else if (newEmotion === 'SURPRISED' || newEmotion === 'EXCITED') {
      this.intensity = 0.8 + Math.random() * 0.2;
    } else if (newEmotion === 'CONTEMPLATIVE' || newEmotion === 'ANALYTICAL') {
      this.intensity = 0.4 + Math.random() * 0.3;
    } else {
      this.intensity = 0.5 + Math.random() * 0.3;
    }
  }
  
  /**
   * Update intensity - passive decay during idle
   */
  private _updateIntensity(): void {
    const now = Date.now();
    const timeSinceDecay = now - this.lastIntensityDecay;
    
    if (timeSinceDecay >= this.intensityDecayInterval) {
      this.lastIntensityDecay = now;
      
      this.intensity = Math.max(
        this.intensityFloor,
        this.intensity - this.intensityDecayRate
      );
      
      console.log(`[Chazy] Intensity decay -> ${this.intensity.toFixed(2)}`);
    }
    
    if (this.intensity <= 0.12 && this.emotion !== 'NEUTRAL') {
      const timeInEmotion = now - this.emotionStartTime;
      if (timeInEmotion > 45000 && now >= this.nextTransitionAllowedAt) {
        console.log(`[Chazy] Low intensity drift -> NEUTRAL`);
        this._transitionTo('NEUTRAL', 'low engagement fade');
      }
    }
  }
  
  /**
   * Weighted random choice from array of {emotion, weight} objects
   */
  private _weightedChoice(choices: EmotionTransition[]): Emotion | null {
    if (!Array.isArray(choices) || choices.length === 0) {
      console.warn('[ChazyMind] Invalid choices in _weightedChoice');
      return null;
    }
    
    const totalWeight = choices.reduce((sum, c) => {
      if (!c || typeof c.weight !== 'number') return sum;
      return sum + Math.max(0, c.weight);
    }, 0);
    
    if (totalWeight === 0) return null;
    
    let rand = Math.random() * totalWeight;
    for (const choice of choices) {
      if (!choice || typeof choice.weight !== 'number') continue;
      rand -= Math.max(0, choice.weight);
      if (rand <= 0) return choice.emotion;
    }
    
    const lastChoice = choices[choices.length - 1];
    return lastChoice?.emotion || null;
  }
  
  /**
   * Get current emotional state
   */
  getState(): EmotionState {
    return {
      emotion: this.emotion,
      intensity: this.intensity,
      duration: Date.now() - this.emotionStartTime,
    };
  }
  
  /**
   * Adjust mode selection weight based on current emotion
   */
  getModeWeight(mode: string): number {
    const weights = this.emotionModeWeights[this.emotion] || {};
    return weights[mode] || 1.0;
  }
  
  /**
   * Get theme preferences based on current emotion
   */
  getPreferredThemes(): string[] {
    const themeMap: Record<Emotion, string[]> = {
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
   */
  shouldInterrupt(eventType: string): boolean {
    const interruptEvents = ['collision', 'ejection'];
    if (!interruptEvents.includes(eventType)) {
      return false;
    }
    
    const interruptChance = this.intensity * 0.4;
    return Math.random() < interruptChance;
  }
  
  /**
   * Reflect on selected text - traverses the emotion graph
   */
  reflectOnText(textData: TextData = {}, themes: string[] = []): void {
    const now = Date.now();
    const timeSinceLastReflection = now - this.lastTextReflection;
    
    if (timeSinceLastReflection < 3000) return;
    this.lastTextReflection = now;
    
    const timeInEmotion = now - this.emotionStartTime;
    
    if (timeInEmotion < 20000) return;
    
    const influence = this.traits.coherence;
    
    const reflectPull = textData.reflect_pull || textData.weights || {};
    
    const totalWeight = Object.values(reflectPull).reduce((sum, w) => sum + w, 0);
    const avgWeight = totalWeight / Math.max(Object.keys(reflectPull).length, 1);
    
    const intensityMultiplier = 1.0 + (0.3 * this.intensity);
    let pressureIncrease = influence * (avgWeight / 3.0) * intensityMultiplier;
    
    const randomNoise = (Math.random() - 0.5) * 0.1;
    pressureIncrease += randomNoise;
    
    this.transitionPressure += pressureIncrease;
    
    const intensityDecayFactor = 1.0 - (0.2 * this.intensity);
    this.transitionPressure *= (0.97 * intensityDecayFactor);
    
    this.transitionPressure = Math.max(0, this.transitionPressure);
    
    const intensityTarget = avgWeight / 3.5;
    const intensityDrift = (intensityTarget - this.intensity) * 0.15;
    
    this.intensity = Math.max(
      this.intensityFloor,
      Math.min(1.0, this.intensity + intensityDrift)
    );
    
    console.log(`[Chazy] Reflecting on text (avg weight: ${avgWeight.toFixed(1)}), pressure: ${this.transitionPressure.toFixed(2)}, intensity: ${this.intensity.toFixed(2)} (target: ${intensityTarget.toFixed(2)})`);
    
    const now2 = Date.now();
    if (now2 < this.nextTransitionAllowedAt) {
      return;
    }
    
    const threshold = this.transitionThresholds[this.emotion] || 1.0;
    
    if (this.transitionPressure >= threshold) {
      const edges = this.emotionGraph[this.emotion];
      
      if (!edges || Object.keys(edges).length === 0) {
        console.log(`[Chazy] No edges from ${this.emotion}, staying put`);
        this.transitionPressure = 0;
        return;
      }
      
      const normalizedWeights = Object.fromEntries(
        Object.entries(reflectPull).map(([k, v]) => [k.toLowerCase(), v])
      );
      
      const modulatedEdges: Record<string, number> = {};
      for (const [targetEmotion, edge] of Object.entries(edges)) {
        const pull = normalizedWeights[targetEmotion.toLowerCase()] ?? 1.0;
        let modulatedWeight = edge.base * pull;
        
        if (targetEmotion === 'NEUTRAL') {
          const neutralReduction = this.intensity * 0.5;
          modulatedWeight *= (1.0 - neutralReduction);
        }
        
        modulatedEdges[targetEmotion] = modulatedWeight;
      }
      
      console.log(`[Chazy] Modulated edges from ${this.emotion}:`, 
        Object.entries(modulatedEdges)
          .map(([e, w]) => `${e}=${w.toFixed(2)}`)
          .join(', ')
      );
      
      if (Math.random() < 0.15) {
        const allEmotions = Object.keys(this.emotionGraph) as Emotion[];
        const kickEmotion = allEmotions[Math.floor(Math.random() * allEmotions.length)];
        if (kickEmotion !== this.emotion) {
          console.log(`[Chazy] Random kick! ${this.emotion} -> ${kickEmotion} (ignoring graph)`);
          this._transitionTo(kickEmotion, 'random perturbation');
          this.transitionPressure = 0;
          return;
        }
      }
      
      const choicesArray: EmotionTransition[] = Object.entries(modulatedEdges).map(([emotion, weight]) => ({
        emotion: emotion as Emotion,
        weight
      }));
      const nextEmotion = this._weightedChoice(choicesArray);
      
      if (nextEmotion && nextEmotion !== this.emotion) {
        const topThemes = themes.slice(0, 2).join(', ');
        console.log(`[Chazy] Graph traversal: ${this.emotion} -> ${nextEmotion} (following ${topThemes || 'momentum'})`);
        this._transitionTo(nextEmotion, `graph traversal via ${topThemes || 'text momentum'}`);
        this.transitionPressure = 0;
      } else {
        this.transitionPressure *= 0.5;
      }
    }
  }
  
  /**
   * Get a summary of recent activity for context
   */
  getRecentActivitySummary(): string {
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
  
  // ─── Mind Autonomy (Timing Control) ────────────────────────────────────────
  
  /**
   * Get ambient delay multiplier based on current emotional state
   */
  getAmbientDelayMultiplier(): number {
    const { emotion, intensity, transitionPressure } = this;
    
    if (emotion === 'EXCITED' && intensity > 0.7) {
      return 0.9;
    }
    
    if (emotion === 'CURIOUS' && transitionPressure > 0.7) {
      return 0.95;
    }
    
    if (emotion === 'SURPRISED' && intensity > 0.5) {
      return 0.9;
    }
    
    if (emotion === 'CONTEMPLATIVE' && intensity < 0.3) {
      return 2.0;
    }
    
    if (emotion === 'CONTEMPLATIVE' && intensity > 0.7) {
      return 1.5;
    }
    
    if (emotion === 'BORED' && intensity < 0.2) {
      return 3.0;
    }
    
    if (emotion === 'ANALYTICAL') {
      return 1.1;
    }
    
    return 1.0;
  }
  
  /**
   * Check if Mind wants to suppress ambient speech right now
   */
  shouldSuppressAmbient(): boolean {
    const now = Date.now();
    
    const timeSinceTransition = now - this.emotionStartTime;
    if (timeSinceTransition < 3000) {
      console.log('[Mind] Just transitioned, need quiet to settle');
      return true;
    }
    
    if (this.emotion === 'CONTEMPLATIVE' && this.intensity > 0.8) {
      if (Math.random() < 0.4) {
        console.log('[Mind] Deep contemplation, staying quiet');
        return true;
      }
    }
    
    const recentEventCount = this.recentEvents.filter(
      e => now - e.timestamp < 10000
    ).length;
    
    if (recentEventCount > 5) {
      console.log('[Mind] Overwhelmed by events, need quiet');
      return true;
    }
    
    if (this.emotion === 'NEUTRAL' && this.intensity < 0.15) {
      if (Math.random() < 0.25) {
        console.log('[Mind] Low engagement, staying quiet');
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Check if emotional transition warrants immediate expression
   */
  private _shouldExpressTransition(from: Emotion, to: Emotion): boolean {
    const dramaticShifts: Array<[Emotion, Emotion]> = [
      ['BORED', 'EXCITED'],
      ['BORED', 'SURPRISED'],
      ['CONTEMPLATIVE', 'SURPRISED'],
      ['CONTEMPLATIVE', 'EXCITED'],
      ['CURIOUS', 'CONCERNED'],
      ['ANALYTICAL', 'AMUSED'],
      ['ANALYTICAL', 'SURPRISED'],
      ['NEUTRAL', 'EXCITED'],
      ['NEUTRAL', 'SURPRISED'],
      ['NEUTRAL', 'CONCERNED'],
    ];
    
    return dramaticShifts.some(
      ([a, b]) => (from === a && to === b) || (from === b && to === a)
    );
  }
  
  /**
   * Request immediate ambient from router
   */
  private _requestImmediateAmbient(reason: string): void {
    console.log(`[Mind] Requesting immediate ambient: ${reason}`);
    
    if ((window as any).chazyEvent) {
      (window as any).chazyEvent('mind_wants_to_speak', { 
        emotion: this.emotion,
        intensity: this.intensity,
        reason 
      });
    }
  }
}
