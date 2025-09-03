import { NextResponse } from "next/server";
import Replicate from "replicate";

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export async function POST(request) {
  const { design_notes } = await request.json();

  const prompt = `
    Design a creative Instagram story background/frame.
    Style instructions: ${design_notes}.
    Do not include or modify the product image itself.
    Leave the center area empty for the product image.
  `;

  const prediction = await replicate.predictions.create({
    model: "black-forest-labs/flux-schnell",
    input: {
      prompt,
      width: 1080,
      height: 1920
    },
  });

  return NextResponse.json(prediction, { status: 201 });
}