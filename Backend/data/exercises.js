/**
 * Exercise Seed Data
 * 
 * Pre-defined exercises mapped to posture flaw types.
 * Used by the recommendation engine and can be seeded
 * into ExerciseRecommendation documents.
 */

const EXERCISES = {
  head_tilt: [
    {
      name: "Chin Tucks",
      description: "Sit upright and gently pull your chin back, creating a double chin. Hold for 5 seconds, release. Repeat 10 times.",
      durationMinutes: 3,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "neck",
    },
    {
      name: "Neck Side Stretch",
      description: "Gently tilt your head toward your right shoulder until you feel a stretch on the left side. Hold 15 seconds. Repeat on other side.",
      durationMinutes: 2,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "neck",
    },
    {
      name: "Neck Rotation Stretch",
      description: "Slowly turn your head to look over your right shoulder. Hold 10 seconds. Return to center, repeat on left. Do 5 each side.",
      durationMinutes: 3,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "neck",
    },
    {
      name: "Levator Scapulae Stretch",
      description: "Tilt head 45° to one side, then gently pull down with your hand. Hold 20 seconds each side.",
      durationMinutes: 3,
      difficulty: "moderate",
      isSafeModeCompatible: false,
      bodyArea: "neck",
    },
  ],

  shoulder_misalignment: [
    {
      name: "Shoulder Rolls",
      description: "Roll both shoulders forward 10 times, then backward 10 times in large, slow circles.",
      durationMinutes: 2,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "shoulders",
    },
    {
      name: "Chest Opener Stretch",
      description: "Clasp hands behind your back, straighten arms and gently lift. Hold 15 seconds. Repeat 3 times.",
      durationMinutes: 2,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "shoulders",
    },
    {
      name: "Doorway Pec Stretch",
      description: "Stand in a doorway, arms at 90° on the frame. Step forward until you feel a stretch across your chest. Hold 30 seconds.",
      durationMinutes: 3,
      difficulty: "moderate",
      isSafeModeCompatible: true,
      bodyArea: "shoulders",
    },
    {
      name: "Resistance Band Pull-Apart",
      description: "Hold a resistance band at shoulder width, arms extended. Pull the band apart by squeezing shoulder blades. 15 reps × 3 sets.",
      durationMinutes: 5,
      difficulty: "moderate",
      isSafeModeCompatible: false,
      bodyArea: "shoulders",
    },
  ],

  forward_lean: [
    {
      name: "Cat-Cow Stretch",
      description: "On hands and knees, alternate between arching your back up (cat) and dipping it down (cow). 10 slow repetitions.",
      durationMinutes: 3,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "back",
    },
    {
      name: "Seated Spinal Twist",
      description: "Sit tall, cross right leg over left. Twist your torso to the right, using your left elbow on your right knee. Hold 20 seconds each side.",
      durationMinutes: 3,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "back",
    },
    {
      name: "Wall Angels",
      description: "Stand with back flat against a wall, arms in a W shape. Slowly slide arms up to form a Y, then back down. 10 reps.",
      durationMinutes: 3,
      difficulty: "moderate",
      isSafeModeCompatible: true,
      bodyArea: "back",
    },
    {
      name: "Superman Hold",
      description: "Lie face down, lift arms, chest, and legs off the floor simultaneously. Hold 5 seconds. Repeat 10 times.",
      durationMinutes: 4,
      difficulty: "moderate",
      isSafeModeCompatible: false,
      bodyArea: "back",
    },
  ],

  too_close: [
    {
      name: "20-20-20 Rule",
      description: "Every 20 minutes, look at something 20 feet away for 20 seconds. This reduces eye strain and encourages sitting back.",
      durationMinutes: 1,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "eyes",
    },
    {
      name: "Palming",
      description: "Rub hands together to warm them, then cup your palms over closed eyes. Breathe deeply for 30 seconds.",
      durationMinutes: 1,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "eyes",
    },
    {
      name: "Seated Back Extension",
      description: "Sit upright, place hands on lower back, and gently arch backward. Hold 10 seconds. Repeat 5 times.",
      durationMinutes: 2,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "back",
    },
  ],

  general: [
    {
      name: "Standing Desk Break",
      description: "Stand up and walk for 2 minutes. Stretch your arms overhead and take deep breaths.",
      durationMinutes: 2,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "full_body",
    },
    {
      name: "Full Body Stretch Sequence",
      description: "Perform a 5-minute sequence: neck rolls → shoulder rolls → side bends → forward fold → quad stretch → calf raises.",
      durationMinutes: 5,
      difficulty: "moderate",
      isSafeModeCompatible: true,
      bodyArea: "full_body",
    },
    {
      name: "Deep Breathing (Box Breathing)",
      description: "Inhale 4 seconds, hold 4 seconds, exhale 4 seconds, hold 4 seconds. Repeat 5 cycles.",
      durationMinutes: 2,
      difficulty: "light",
      isSafeModeCompatible: true,
      bodyArea: "full_body",
    },
  ],
};

/**
 * Get exercises for a specific flaw type.
 * @param {string} flawType - One of: head_tilt, shoulder_misalignment, forward_lean, too_close, general
 * @param {Object} options - { safeMode: boolean, difficulty: string }
 * @returns {Array} Filtered exercise list
 */
function getExercisesForFlaw(flawType, options = {}) {
  const { safeMode = false, difficulty = null } = options;
  let exercises = EXERCISES[flawType] || EXERCISES.general;

  if (safeMode) {
    exercises = exercises.filter((e) => e.isSafeModeCompatible);
  }

  if (difficulty) {
    exercises = exercises.filter((e) => e.difficulty === difficulty);
  }

  return exercises;
}

/**
 * Get all exercises for multiple detected flaws.
 * @param {string[]} flawTypes - Array of flaw type strings
 * @param {Object} options - { safeMode: boolean }
 * @returns {Object} { [flawType]: exercises[] }
 */
function getRecommendations(flawTypes, options = {}) {
  const result = {};
  const types = flawTypes.length > 0 ? flawTypes : ["general"];

  for (const flawType of types) {
    result[flawType] = getExercisesForFlaw(flawType, options);
  }

  // Always include a general recommendation
  if (!result.general) {
    result.general = getExercisesForFlaw("general", options);
  }

  return result;
}

/**
 * Determine severity based on session scores.
 * @param {Object} scores - { headTilt, shoulderAlignment, spinalPosture, proximity, overall }
 * @returns {string} "mild" | "moderate" | "severe"
 */
function determineSeverity(scores) {
  const overall = scores.overall || scores.overallScore || 100;
  if (overall >= 70) return "mild";
  if (overall >= 40) return "moderate";
  return "severe";
}

module.exports = {
  EXERCISES,
  getExercisesForFlaw,
  getRecommendations,
  determineSeverity,
};
