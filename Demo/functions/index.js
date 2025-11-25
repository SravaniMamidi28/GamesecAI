const functions = require("firebase-functions");
const { GoogleGenAI } = require("@google/genai");
const admin = require("firebase-admin");

admin.initializeApp();

// Get the Gemini API key from Firebase config (secure)
const apiKey = functions.config().gemini?.key;

// Initialize the Gemini client
const ai = new GoogleGenAI({ apiKey });

// Callable Cloud Function for generating quiz questions
exports.generateQuizQuestion = functions.https.onCall(async (data, context) => {
  // Optional: require user to be authenticated
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "You must be logged in to use this function."
    );
  }

  const prompt = data.prompt;
  const model = data.model || "gemini-2.5-flash";

  if (!apiKey) {
    throw new functions.https.HttpsError(
      "internal",
      "AI service not configured on the server."
    );
  }

  try {
    // Server-side call to Gemini API
    const response = await ai.models.generateContent({
      model,
      contents: prompt,
    });

    // Return generated text to client
    return response.text;
  } catch (error) {
    console.error("AI generation failed:", error);
    throw new functions.https.HttpsError(
      "internal",
      `AI generation failed: ${error.message}`
    );
  }
});
