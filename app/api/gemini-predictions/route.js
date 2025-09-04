import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Replicate from "replicate";

const genAI = new GoogleGenerativeAI("AIzaSyC2tHry5e1zqSNd3eBIbew_F4floo6Qtlk");
const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// Function to try Gemini API for image generation
async function tryGemini(design_notes, images) {
  // Try the actual model you mentioned
  const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash-image-preview",
    generationConfig: {
      temperature: 0.9,
      topK: 32,
      topP: 1,
      maxOutputTokens: 8192,
    }
  });

  // Create a prompt specifically for image generation
  const prompt = `Generate a vibrant Instagram story background image (9:16 aspect ratio, 1080x1920px) for a multiple product gallery showcase.

Design requirements:
- Style: ${design_notes || 'Modern, eye-catching design'}
- Create an engaging background suitable for showcasing multiple products
- Leave the center areas empty/minimal for product image overlays
- Use complementary colors and patterns
- Make it visually appealing but not overwhelming
- Suitable for e-commerce product display
- Professional yet eye-catching design

Create the actual background image, not a description.`;

  console.log("Calling Gemini with model: gemini-2.5-flash-image-preview");
  console.log("Prompt:", prompt);
  console.log("Number of images provided:", images.length);

  // Convert base64 images to the format Gemini expects
  const imageParts = images.map((base64Image, index) => {
    console.log(`Processing image ${index + 1}`);
    return {
      inlineData: {
        data: base64Image,
        mimeType: "image/jpeg"
      }
    };
  });

  // Create the content array with prompt and images
  const content = [prompt, ...imageParts];

  try {
    const result = await model.generateContent(content);
    const response = await result.response;
    
    console.log("Gemini response received");
    console.log("Response text length:", response.text()?.length || 0);
    
    // Log the full response to understand its structure
    const fullResponse = {
      text: response.text(),
      candidates: response.candidates,
      promptFeedback: response.promptFeedback,
    };
    console.log("Full Gemini response:", JSON.stringify(fullResponse, null, 2));

    // Check if response contains image data
    const responseText = response.text();
    const candidates = response.candidates || [];
    
    // Look for image data in different possible locations
    let imageData = null;
    
    // Check candidates for parts that might contain images
    for (const candidate of candidates) {
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          console.log("Checking part:", part);
          if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('image/')) {
            imageData = part.inlineData;
            break;
          }
        }
      }
    }

    if (imageData) {
      console.log("Found image data with mimeType:", imageData.mimeType);
      const imageUrl = `data:${imageData.mimeType};base64,${imageData.data}`;
      
      return {
        id: `gemini_${Date.now()}`,
        status: "succeeded",
        output: [imageUrl],
        created_at: new Date().toISOString(),
        model: "gemini-2.5-flash-image-preview",
        fallback_used: false
      };
    } else {
      console.log("No image data found in response. Response text:", responseText);
      throw new Error("Gemini did not return image data. Response: " + responseText.substring(0, 200));
    }

  } catch (error) {
    console.error("Error in Gemini API call:", error);
    throw error;
  }
}

// Function to fallback to Replicate
async function fallbackToReplicate(design_notes, images) {
  const prompt = `
    Design a creative Instagram story background/frame for a multiple product gallery.
    Style instructions: ${design_notes || 'Modern, eye-catching design'}.
    Create a background suitable for showcasing multiple products.
    Do not include or modify the product images themselves.
    Leave the center area empty for the product images.
    Make it vibrant and engaging for a product collection showcase.
  `;

  const prediction = await replicate.predictions.create({
    model: "black-forest-labs/flux-schnell",
    input: {
      prompt,
      width: 1080,
      height: 1920
    },
  });

  return {
    ...prediction,
    fallback_used: true,
    original_service: "replicate"
  };
}

export async function POST(request) {
  try {
    const { design_notes, images } = await request.json();

    // First, try Gemini
    try {
      console.log("Attempting Gemini API call...");
      const geminiResponse = await tryGemini(design_notes, images);
      console.log("Gemini API call successful");
      return NextResponse.json(geminiResponse, { status: 201 });
    } catch (geminiError) {
      console.log("Gemini API failed, falling back to Replicate:", geminiError.message);
      
      // Check if it's a specific overload error or any error
      const isOverloadError = geminiError.message.includes("overloaded") || 
                             geminiError.message.includes("503") ||
                             geminiError.message.includes("Service Unavailable");
      
      // Fallback to Replicate
      try {
        console.log("Attempting Replicate fallback...");
        const replicateResponse = await fallbackToReplicate(design_notes, images);
        console.log("Replicate fallback successful");
        return NextResponse.json(replicateResponse, { status: 201 });
      } catch (replicateError) {
        console.error("Both Gemini and Replicate failed:", replicateError);
        throw new Error(`Both services failed. Gemini: ${geminiError.message}, Replicate: ${replicateError.message}`);
      }
    }
  } catch (error) {
    console.error("Complete API failure:", error);
    return NextResponse.json(
      { detail: error.message || "Both Gemini and Replicate services failed" },
      { status: 500 }
    );
  }
}