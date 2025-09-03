# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

StoryGen is a Next.js application that generates Instagram story backgrounds using AI. Users can upload product images, enter product details, and generate custom story backgrounds using the Replicate API with the FLUX-Schnell model.

## Development Commands

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build production app with Turbopack  
- `npm start` - Start production server
- `npm run lint` - Run ESLint

## Architecture

### Tech Stack
- **Framework**: Next.js 15.5.2 with App Router
- **Styling**: Tailwind CSS v4
- **AI Service**: Replicate API (FLUX-Schnell model)
- **Fonts**: Geist Sans and Geist Mono

### Key Components

**Frontend (`app/page.js`)**:
- Single-page React component handling the main UI
- Form inputs for product details (title, price, description, non-profit, image upload, design notes)
- Real-time preview with text overlays on generated backgrounds
- File upload handling with base64 conversion
- Polling mechanism for async AI generation

**API Routes**:
- `app/api/predictions/route.js` - POST endpoint to create AI image generation predictions
- `app/api/predictions/[id]/route.js` - GET endpoint to poll prediction status

### Environment Variables
- `REPLICATE_API_TOKEN` - Required for Replicate API authentication

### Image Handling
- Next.js configured to allow images from `replicate.com` and `replicate.delivery` domains
- Frontend handles image uploads via FileReader API and base64 conversion
- Generated backgrounds are 1080x1920 (Instagram story dimensions)

### Key Features
- Real-time preview with font style selection
- Download and share functionality for generated stories
- Product image overlay on AI-generated backgrounds
- Form validation and error handling
- Loading states during AI generation