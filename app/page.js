'use client';

import { useState, useRef } from "react";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default function Home() {
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [fontStyle, setFontStyle] = useState("sans-serif");
  const [isLoading, setIsLoading] = useState(false);
  const [textColor, setTextColor] = useState("white");
  const [isDragging, setIsDragging] = useState(null);
  const [positions, setPositions] = useState({
    image_0: { x: 35, y: 40 },
    image_1: { x: 65, y: 40 },
    image_2: { x: 35, y: 60 },
    image_3: { x: 65, y: 60 },
    title: { x: 50, y: 15 },
    description: { x: 50, y: 22 },
    swaysell: { x: 50, y: 70 },
    price: { x: 50, y: 80 },
    nonprofit: { x: 50, y: 90 }
  });

  const [sizes, setSizes] = useState({
    image_0: { width: 130, height: 130 },
    image_1: { width: 130, height: 130 },
    image_2: { width: 130, height: 130 },
    image_3: { width: 130, height: 130 },
    title: { fontSize: 60 },
    description: { fontSize: 25 },
    swaysell: { fontSize: 20 },
    price: { fontSize: 30 },
    nonprofit: { fontSize: 30 }
  });

  const [isResizing, setIsResizing] = useState(null);
  const [resizeStart, setResizeStart] = useState(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [workflowType, setWorkflowType] = useState('single'); // 'single' or 'multiple'
  const [selectedImages, setSelectedImages] = useState([]); // indices of selected images for multiple workflow
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const renderCanvasRef = useRef(null);

  const [formData, setFormData] = useState({
    title: '',
    price: '',
    minPrice: '',
    maxPrice: '',
    description: '',
    'non-profit': '',
    design_notes: ''
  });

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async () => {
    setError(null);
    setPrediction(null);
    setIsLoading(true);

    // Validation for multiple workflow
    if (workflowType === 'multiple') {
      if (selectedImages.length < 2 || selectedImages.length > 4) {
        setError('Please select between 2-4 images to display.');
        setIsLoading(false);
        return;
      }
      if (!formData.minPrice || !formData.maxPrice) {
        setError('Please enter both minimum and maximum prices.');
        setIsLoading(false);
        return;
      }
    }

    // Validation for single workflow
    if (workflowType === 'single') {
      if (!formData.price) {
        setError('Please enter a price.');
        setIsLoading(false);
        return;
      }
    }

    let base64Images = [];
    if (imageFiles.length > 0) {
      // Convert images based on workflow
      if (workflowType === 'single') {
        base64Images = await Promise.all(
          imageFiles.map(file => fileToBase64(file))
        );
      } else {
        // Convert only selected images for multiple workflow
        const selectedFiles = selectedImages.map(index => imageFiles[index]);
        base64Images = await Promise.all(
          selectedFiles.map(file => fileToBase64(file))
        );
      }
    }

    const payload = {
      design_notes: formData.design_notes,
      images: base64Images,
    };

    // Use different APIs based on workflow type
    const apiEndpoint = workflowType === 'single' ? '/api/predictions' : '/api/gemini-predictions';

    try {
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      let prediction = await response.json();
      if (response.status !== 201) {
        setError(prediction.detail);
        setIsLoading(false);
        return;
      }
      setPrediction(prediction);

      // Handle polling differently based on workflow and response
      if (workflowType === 'single') {
        // Single workflow: Always uses Replicate, needs polling
        while (
          prediction.status !== "succeeded" &&
          prediction.status !== "failed"
        ) {
          await sleep(1000);
          const poll = await fetch("/api/predictions/" + prediction.id);
          prediction = await poll.json();
          if (poll.status !== 200) {
            setError(prediction.detail);
            setIsLoading(false);
            return;
          }
          setPrediction(prediction);
        }
      } else if (workflowType === 'multiple') {
        // Multiple workflow: Check if fallback to Replicate was used
        if (prediction.fallback_used && prediction.original_service === 'replicate') {
          // Fallback used Replicate, need to poll
          while (
            prediction.status !== "succeeded" &&
            prediction.status !== "failed"
          ) {
            await sleep(1000);
            const poll = await fetch("/api/predictions/" + prediction.id);
            prediction = await poll.json();
            if (poll.status !== 200) {
              setError(prediction.detail);
              setIsLoading(false);
              return;
            }
            setPrediction(prediction);
          }
        }
        // If Gemini was successful (no fallback), no polling needed - direct response
      }
      
      // Analyze background color for text contrast when generation is complete
      if (prediction.status === "succeeded" && prediction.output && prediction.output.length > 0) {
        try {
          const colorAnalysis = await analyzeBackgroundColor(prediction.output[prediction.output.length - 1]);
          setTextColor(colorAnalysis);
        } catch (error) {
          console.log("Could not analyze background color, using default text color");
        }
      }
    } catch (err) {
      setError("An error occurred while generating your story.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    const totalFiles = imageFiles.length + files.length;
    const maxImages = workflowType === 'single' ? 3 : 15;
    
    if (totalFiles > maxImages) {
      alert(`Maximum ${maxImages} images allowed for ${workflowType} workflow. Please remove some images first.`);
      return;
    }
    
    setImageFiles(prevFiles => [...prevFiles, ...files]);
  };

  const removeImage = (indexToRemove) => {
    setImageFiles(prevFiles => prevFiles.filter((_, index) => index !== indexToRemove));
    
    // Update selectedImages if in multiple workflow
    if (workflowType === 'multiple') {
      setSelectedImages(prevSelected => 
        prevSelected
          .filter(index => index !== indexToRemove)
          .map(index => index > indexToRemove ? index - 1 : index)
      );
    }
  };

  const handleMouseDown = (elementType, e) => {
    setIsDragging(elementType);
    setIsResizing(null);
    e.preventDefault();
    e.stopPropagation();
  };

  const handleResizeDown = (elementType, e) => {
    setIsResizing(elementType);
    setIsDragging(null);
    
    // Store initial size and mouse position for more stable resize
    const rect = e.currentTarget.closest('[data-story-container]').getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const currentSize = elementType.startsWith('image_') 
      ? sizes[elementType].width 
      : sizes[elementType].fontSize;
      
    setResizeStart({
      mouseX,
      mouseY,
      initialSize: currentSize
    });
    
    e.preventDefault();
    e.stopPropagation();
  };

  const handleMouseMove = (e) => {
    if (!isDragging && !isResizing) return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    
    if (isDragging) {
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      
      // Constrain to bounds (allow closer to edges for more flexibility)
      const constrainedX = Math.max(-5, Math.min(105, x));
      const constrainedY = Math.max(-5, Math.min(105, y));
      
      setPositions(prev => ({
        ...prev,
        [isDragging]: { x: constrainedX, y: constrainedY }
      }));
    }
    
    if (isResizing && resizeStart) {
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      
      // Calculate distance change from initial position
      const deltaX = mouseX - resizeStart.mouseX;
      const deltaY = mouseY - resizeStart.mouseY;
      const deltaDistance = Math.sqrt(deltaX ** 2 + deltaY ** 2);
      
      // Use sign of deltaX to determine if growing or shrinking
      const direction = deltaX > 0 ? 1 : -1;
      const sizeChange = direction * deltaDistance * 0.5;
      
      if (isResizing.startsWith('image_')) {
        const newSize = Math.max(50, Math.min(300, resizeStart.initialSize + sizeChange));
        setSizes(prev => ({
          ...prev,
          [isResizing]: { width: newSize, height: newSize }
        }));
      } else {
        // Text element resize
        const fontSizeChange = sizeChange * 0.3;
        const newFontSize = Math.max(10, Math.min(120, resizeStart.initialSize + fontSizeChange));
        setSizes(prev => ({
          ...prev,
          [isResizing]: { fontSize: newFontSize }
        }));
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(null);
    setIsResizing(null);
    setResizeStart(null);
  };

  const resetPositions = () => {
    setPositions({
      image_0: { x: 35, y: 40 },
      image_1: { x: 65, y: 40 },
      image_2: { x: 35, y: 60 },
      image_3: { x: 65, y: 60 },
      title: { x: 50, y: 15 },
      description: { x: 50, y: 22 },
      swaysell: { x: 50, y: 70 },
      price: { x: 50, y: 80 },
      nonprofit: { x: 50, y: 90 }
    });
    setSizes({
      image_0: { width: 130, height: 130 },
      image_1: { width: 130, height: 130 },
      image_2: { width: 130, height: 130 },
      image_3: { width: 130, height: 130 },
      title: { fontSize: 60 },
      description: { fontSize: 25 },
      swaysell: { fontSize: 20 },
      price: { fontSize: 30 },
      nonprofit: { fontSize: 30 }
    });
  };

  const analyzeBackgroundColor = (imageUrl) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);
        
        // Sample multiple points to get average brightness
        const samplePoints = [
          { x: img.width * 0.5, y: img.height * 0.15 }, // Title area
          { x: img.width * 0.5, y: img.height * 0.22 }, // Description area
          { x: img.width * 0.5, y: img.height * 0.8 },  // Price area
          { x: img.width * 0.5, y: img.height * 0.9 },  // Non-profit area
        ];
        
        let totalBrightness = 0;
        
        samplePoints.forEach(point => {
          const imageData = ctx.getImageData(point.x, point.y, 1, 1);
          const [r, g, b] = imageData.data;
          // Calculate brightness using luminance formula
          const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
          totalBrightness += brightness;
        });
        
        const avgBrightness = totalBrightness / samplePoints.length;
        // If background is bright, use dark text; if dark, use light text
        const textColor = avgBrightness > 0.5 ? '#000000' : '#ffffff';
        const textShadow = avgBrightness > 0.5 ? '2px 2px 4px rgba(255,255,255,0.8)' : '2px 2px 4px rgba(0,0,0,0.8)';
        
        resolve({ textColor, textShadow });
      };
      img.src = imageUrl;
    });
  };

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const base64 = reader.result.split(",")[1];
        resolve(base64);
      };
      reader.onerror = (error) => reject(error);
    });
  };

  const renderStoryToCanvas = async (includeSwaySell = true, format = 'instagram') => {
    if (!prediction || !prediction.output) return;

    setIsRendering(true);
    
    const canvas = renderCanvasRef.current;
    const ctx = canvas.getContext('2d');
    
    // Set canvas dimensions based on format
    const targetWidth = 540;  
    const targetHeight = 960; 
    
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    
    try {
      // Load and draw background image
      const bgImage = new Image();
      bgImage.crossOrigin = "anonymous";
      
      await new Promise((resolve, reject) => {
        bgImage.onload = resolve;
        bgImage.onerror = reject;
        bgImage.src = prediction.output[prediction.output.length - 1];
      });
      
      ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height);
      
      // Calculate scaling factor based on preview container
      const scaleX = canvas.width / 540;
      const scaleY = canvas.height / 960;
      
      // Load and draw product images based on workflow
      let imagesToRender = [];
      if (workflowType === 'single') {
        imagesToRender = imageFiles;
      } else if (workflowType === 'multiple') {
        imagesToRender = selectedImages.map(index => imageFiles[index]).filter(Boolean);
      }
      
      const imagePromises = imagesToRender.map(async (file, index) => {
        const imageKey = `image_${index}`;
        const position = positions[imageKey];
        const size = sizes[imageKey];
        
        const img = new Image();
        const imageUrl = URL.createObjectURL(file);
        
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = imageUrl;
        });
        
        // Scale the positioning and sizing to match canvas
        const scaledWidth = size.width * scaleX;
        const scaledHeight = size.height * scaleY;
        const x = (position.x / 100) * canvas.width - scaledWidth / 2;
        const y = (position.y / 100) * canvas.height - scaledHeight / 2;
        
        ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
        URL.revokeObjectURL(imageUrl);
      });
      
      await Promise.all(imagePromises);
      
      // Draw text elements
      const priceText = workflowType === 'single' 
        ? `Price: ${formData.price}` 
        : `Price: ${formData.minPrice} - ${formData.maxPrice}`;
        
      const textElements = [
        { key: 'title', text: formData.title, weight: 'bold' },
        { key: 'description', text: formData.description, weight: 'bold' },
        { key: 'price', text: priceText, weight: '600' },
        { key: 'nonprofit', text: `Supporting: ${formData['non-profit']}`, weight: '600' }
      ];
      
      if (includeSwaySell) {
        textElements.push({ key: 'swaysell', text: 'Insert SwaySell Link Here', weight: '500' });
      }
      
      textElements.forEach(({ key, text, weight }) => {
        if (!text) return;
        
        const position = positions[key];
        const size = sizes[key];
        
        const x = (position.x / 100) * canvas.width;
        const y = (position.y / 100) * canvas.height;
        
        // Scale font size to match canvas
        const scaledFontSize = size.fontSize * Math.min(scaleX, scaleY);
        
        // Set font properties
        const fontWeight = weight;
        const fontFamily = fontStyle === 'sans-serif' ? 'Arial, sans-serif' :
                          fontStyle === 'serif' ? 'Georgia, serif' :
                          fontStyle === 'cursive' ? 'cursive' :
                          fontStyle === 'monospace' ? 'monospace' :
                          fontStyle === 'bold' ? 'Arial Black, sans-serif' :
                          'Arial, sans-serif';
        
        ctx.font = `${fontWeight} ${scaledFontSize}px ${fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        // Apply text color and shadow
        const color = textColor?.textColor || '#ffffff';
        ctx.fillStyle = color;
        
        // Add text shadow (scaled)
        const shadowBlur = 4 * Math.min(scaleX, scaleY);
        const shadowOffset = 2 * Math.min(scaleX, scaleY);
        
        ctx.shadowColor = color === '#000000' ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = shadowBlur;
        ctx.shadowOffsetX = shadowOffset;
        ctx.shadowOffsetY = shadowOffset;
        
        ctx.fillText(text, x, y);
        
        // Reset shadow
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
      });
      
    } catch (error) {
      console.error('Error rendering story:', error);
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownload = () => {
    setShowDownloadModal(true);
  };

  const downloadStory = async (includeSwaySell, format = 'instagram') => {
    await renderStoryToCanvas(includeSwaySell, format);
    
    const canvas = renderCanvasRef.current;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    
    const platformName = format === 'instagram' ? 'instagram' : 'facebook';
    const linkText = includeSwaySell ? 'with-link' : 'no-link';
    link.download = `${platformName}-story-${linkText}-${Date.now()}.png`;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    setShowDownloadModal(false);
  };

  const handleShare = async () => {
    if (!prediction || !prediction.output) {
      alert('Please generate a story first before sharing');
      return;
    }

    try {
      // Generate the clean image without SwaySell link
      await renderStoryToCanvas(false, 'instagram'); // false = no SwaySell link
      
      const canvas = renderCanvasRef.current;
      
      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], 'story.png', { type: 'image/png' })] })) {
          // Share the actual image file
          try {
            const file = new File([blob], 'instagram-story.png', { type: 'image/png' });
            await navigator.share({
              title: 'Check out my AI-generated Instagram Story!',
              text: 'Generated with AI Story Generator',
              files: [file]
            });
          } catch (error) {
            console.log('Error sharing file:', error);
            // Fallback to copying image as data URL
            fallbackToDataUrlShare(canvas);
          }
        } else {
          // Fallback for browsers that don't support file sharing
          fallbackToDataUrlShare(canvas);
        }
      }, 'image/png');
      
    } catch (error) {
      console.error('Error preparing image for sharing:', error);
      alert('Error preparing image for sharing');
    }
  };

  const fallbackToDataUrlShare = (canvas) => {
    const dataUrl = canvas.toDataURL('image/png');
    
    if (navigator.share) {
      // Share with data URL (some platforms support this)
      navigator.share({
        title: 'Check out my AI-generated Instagram Story!',
        text: 'Generated with AI Story Generator',
        url: dataUrl
      }).catch(() => {
        // Final fallback - copy to clipboard
        copyImageToClipboard(canvas);
      });
    } else {
      // Copy to clipboard for desktop browsers
      copyImageToClipboard(canvas);
    }
  };

  const copyImageToClipboard = async (canvas) => {
    try {
      // Try to copy image to clipboard
      canvas.toBlob(async (blob) => {
        const item = new ClipboardItem({ 'image/png': blob });
        await navigator.clipboard.write([item]);
        alert('✅ Clean story image copied to clipboard! (No SwaySell link included)');
      }, 'image/png');
    } catch (error) {
      console.log('Clipboard not supported, showing download link');
      // Final fallback - trigger download
      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `clean-instagram-story-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      alert('✅ Clean story image downloaded! (No SwaySell link included)');
    }
  };

  const handleWorkflowChange = (newWorkflowType) => {
    setWorkflowType(newWorkflowType);
    // Reset form and images when switching workflows
    setImageFiles([]);
    setSelectedImages([]);
    setPrediction(null);
    setError(null);
    setFormData({
      title: '',
      price: '',
      minPrice: '',
      maxPrice: '',
      description: '',
      'non-profit': '',
      design_notes: ''
    });
    resetPositions();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400">
      <div className="container max-w-6xl mx-auto p-6">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-5xl font-bold text-white mb-4 drop-shadow-lg">
            ✨ AI Story Creator ✨
          </h1>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Form Section */}
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8">
            <div className="flex items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-800">Product Details</h2>
            </div>

            {/* Workflow Selection */}
            <div className="mb-6">
              <label className="block text-sm font-semibold text-gray-700 mb-3">Post Type</label>
              <div className="flex space-x-4">
                <button
                  type="button"
                  onClick={() => handleWorkflowChange('single')}
                  className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all duration-200 ${
                    workflowType === 'single'
                      ? 'bg-purple-600 text-white shadow-lg'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <div className="text-center">
                    <div className="text-lg font-bold">Single Product Post</div>
                    <div className="text-sm opacity-90">One product, up to 3 images</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleWorkflowChange('multiple')}
                  className={`flex-1 px-4 py-3 rounded-xl font-medium transition-all duration-200 ${
                    workflowType === 'multiple'
                      ? 'bg-purple-600 text-white shadow-lg'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  <div className="text-center">
                    <div className="text-lg font-bold">Multiple Product Gallery</div>
                    <div className="text-sm opacity-90">Multiple products showcase</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-6">
              {/* Image Upload */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Product Images</label>
                <div className="relative">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                    ref={fileInputRef}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full px-4 py-6 border-2 border-dashed border-gray-300 rounded-xl hover:border-purple-400 hover:bg-purple-50 transition-all duration-200 flex flex-col items-center justify-center space-y-2"
                  >
                    <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                    </svg>
                    <span className="text-gray-600 font-medium">
                      {imageFiles.length > 0 ? `${imageFiles.length} image(s) selected` : "Click to upload images"}
                    </span>
                  </button>
                </div>
                {imageFiles.length > 0 && (
                  <div className="mt-3 space-y-3">
                    {/* Show different messages based on workflow */}
                    {workflowType === 'single' && imageFiles.length === 3 && (
                      <p className="text-sm text-orange-600 bg-orange-50 p-3 rounded-lg">
                        ℹ️ Maximum 3 images reached
                      </p>
                    )}
                    {workflowType === 'multiple' && imageFiles.length > 0 && (
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <p className="text-sm text-blue-700">
                          📁 {imageFiles.length}/15 images uploaded • Select 2-4 to display ({selectedImages.length}/4 selected)
                        </p>
                        {selectedImages.length === 0 && imageFiles.length > 0 && (
                          <p className="text-xs text-blue-600 mt-1">Click on images below to select which ones to display (min 2, max 4)</p>
                        )}
                        {selectedImages.length === 1 && (
                          <p className="text-xs text-amber-600 mt-1">Select at least 1 more image to continue</p>
                        )}
                        {selectedImages.length >= 2 && selectedImages.length <= 4 && (
                          <p className="text-xs text-green-600 mt-1">✓ Ready to generate ({selectedImages.length} images selected)</p>
                        )}
                      </div>
                    )}
                    
                    <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                      {imageFiles.map((file, index) => {
                        const isSelected = selectedImages.includes(index);
                        return (
                          <div key={index} className="relative group">
                            <div 
                              className={`aspect-square rounded-lg overflow-hidden bg-gray-100 cursor-pointer transition-all duration-200 ${
                                workflowType === 'multiple' 
                                  ? (isSelected ? 'ring-4 ring-blue-400 ring-opacity-75' : 'hover:ring-2 hover:ring-gray-300') 
                                  : ''
                              }`}
                              onClick={() => {
                                if (workflowType === 'multiple') {
                                  if (isSelected) {
                                    setSelectedImages(prev => prev.filter(i => i !== index));
                                  } else if (selectedImages.length < 4) {
                                    setSelectedImages(prev => [...prev, index]);
                                  } else {
                                    // Optional: Show message when trying to select more than 4
                                    // You can add a toast notification here if desired
                                  }
                                }
                              }}
                            >
                              <img
                                src={URL.createObjectURL(file)}
                                alt={file.name}
                                className="w-full h-full object-cover"
                              />
                              {/* Selection indicator for multiple workflow */}
                              {workflowType === 'multiple' && (
                                <div className="absolute top-1 left-1">
                                  <div className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center ${
                                    isSelected ? 'bg-blue-500 text-white' : 'bg-gray-300'
                                  }`}>
                                    {isSelected ? <span className="text-xs font-bold">{selectedImages.indexOf(index) + 1}</span> : ''}
                                  </div>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => removeImage(index)}
                              className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10"
                            >
                              ✕
                            </button>
                            <p className="text-xs text-gray-600 mt-1 truncate">{file.name}</p>
                            {/* Show "Will show" for single workflow or selected images in multiple workflow */}
                            {(workflowType === 'single' || (workflowType === 'multiple' && isSelected)) && (
                              <span className="absolute top-1 right-1 bg-green-500 text-white text-xs px-1 rounded">
                                Will show
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Product Title */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Product Title</label>
                <input
                  type="text"
                  name="title"
                  value={formData.title}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                  placeholder="Amazing Product Name"
                  required
                />
              </div>

              {/* Price - Different for each workflow */}
              {workflowType === 'single' ? (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">Price</label>
                  <input
                    type="text"
                    name="price"
                    value={formData.price}
                    onChange={handleInputChange}
                    className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                    placeholder="$29.99"
                    required
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    Price Range <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500">Both minimum and maximum prices are required</p>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text"
                      name="minPrice"
                      value={formData.minPrice}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                      placeholder="Min ($10)"
                      required
                    />
                    <input
                      type="text"
                      name="maxPrice"
                      value={formData.maxPrice}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                      placeholder="Max ($100)"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Description */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Description</label>
                <input
                  type="text"
                  name="description"
                  value={formData.description}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                  placeholder="100% cotton, premium quality"
                  required
                />
              </div>

              {/* Non-profit */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Supporting Non-profit</label>
                <input
                  type="text"
                  name="non-profit"
                  value={formData['non-profit']}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                  placeholder="Red Cross, Greenpeace"
                  required
                />
              </div>

              {/* Design Notes */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Design Notes (Optional)</label>
                <textarea
                  name="design_notes"
                  value={formData.design_notes}
                  onChange={handleInputChange}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white resize-none"
                  placeholder="Background style, colors, mood..."
                  rows={3}
                />
              </div>

              {/* Font Style */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold text-gray-700">Font Style</label>
                <select
                  value={fontStyle}
                  onChange={(e) => setFontStyle(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-200 focus:border-purple-400 transition-all duration-200 bg-gray-50 focus:bg-white"
                >
                  <option value="sans-serif">Sans-serif (Modern)</option>
                  <option value="serif">Serif (Classic)</option>
                  <option value="cursive">Cursive (Elegant)</option>
                  <option value="monospace">Monospace (Tech)</option>
                  <option value="bold">Bold (Impact)</option>
                </select>
              </div>

              {/* Generate Button */}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isLoading}
                className="w-full bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold py-4 px-6 rounded-xl hover:from-purple-700 hover:to-pink-700 transform hover:scale-105 transition-all duration-200 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex items-center justify-center space-x-3"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    <span>Creating Magic...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Generate Story</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Preview Section */}
          <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center">
                <h2 className="text-2xl font-bold text-gray-800">Preview</h2>
              </div>
              
              {prediction && prediction.output && (
                <div className="flex space-x-3">
                  <button
                    onClick={resetPositions}
                    className="bg-purple-500 hover:bg-purple-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Reset</span>
                  </button>
                  <button
                    onClick={handleDownload}
                    className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <span>Download</span>
                  </button>
                  <button
                    onClick={handleShare}
                    className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                    <span>Share</span>
                  </button>
                </div>
              )}
            </div>

            {/* Error Display */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border-l-4 border-red-400 rounded-lg">
                <div className="flex">
                  <svg className="w-5 h-5 text-red-400 mr-3 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-red-700">{error}</p>
                </div>
              </div>
            )}

            {/* Loading State */}
            {isLoading && !prediction && (
              <div className="text-center py-20">
                <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-4 border-purple-600 mb-4"></div>
                <p className="text-gray-600 text-lg">Creating your story...</p>
              </div>
            )}

            {/* Generated Story Preview */}
            {prediction && prediction.output && (
              <div className="relative w-full max-w-lg mx-auto">
                <div 
                  className="relative w-full aspect-[9/16] bg-gray-100 rounded-2xl overflow-hidden shadow-lg cursor-crosshair select-none"
                  data-story-container
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                >
                  <img
                    src={prediction.output[prediction.output.length - 1]}
                    alt="Generated Background"
                    className="w-full h-full object-cover pointer-events-none"
                  />
                  
                  {/* Instruction overlay */}
                  <div className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded z-10">
                    💡 Drag to move • Blue corner to resize
                  </div>

                  {/* Individual draggable and resizable images */}
                  {(() => {
                    // For single workflow, show all images (up to 3)
                    // For multiple workflow, show only selected images (up to 4)
                    let imagesToShow = [];
                    if (workflowType === 'single') {
                      imagesToShow = imageFiles;
                    } else if (workflowType === 'multiple') {
                      imagesToShow = selectedImages.map(index => imageFiles[index]).filter(Boolean);
                    }
                    
                    return imagesToShow.map((file, displayIndex) => {
                      const imageKey = `image_${displayIndex}`;
                      const position = positions[imageKey];
                      const size = sizes[imageKey];
                      
                      return (
                        <div
                          key={displayIndex}
                          className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${isDragging === imageKey || isResizing === imageKey ? 'z-50' : ''}`}
                          style={{
                            left: `${position.x}%`,
                            top: `${position.y}%`
                          }}
                        >
                          <div 
                            className={`relative group ${isDragging === imageKey ? 'ring-2 ring-purple-400 ring-opacity-50' : ''} ${isResizing === imageKey ? 'ring-2 ring-blue-400 ring-opacity-50' : ''} transition-all duration-200`}
                            onMouseDown={(e) => handleMouseDown(imageKey, e)}
                          >
                            <img
                              src={URL.createObjectURL(file)}
                              alt={`Product Image ${displayIndex + 1}`}
                              className="object-contain cursor-move pointer-events-none"
                              style={{
                                width: `${size.width}px`,
                                height: `${size.height}px`
                              }}
                            />
                            
                            {/* Resize handle */}
                            <div
                              className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                              onMouseDown={(e) => handleResizeDown(imageKey, e)}
                            />
                          </div>
                        </div>
                      );
                    });
                  })()}

                  {/* Text Overlays */}
                  {/* Title */}
                  <div
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${isDragging === 'title' || isResizing === 'title' ? 'z-50' : ''}`}
                    style={{ 
                      left: `${positions.title.x}%`,
                      top: `${positions.title.y}%`
                    }}
                  >
                    <div className={`relative group ${isDragging === 'title' ? 'ring-2 ring-purple-400 ring-opacity-50 shadow-2xl' : ''} ${isResizing === 'title' ? 'ring-2 ring-blue-400 ring-opacity-50' : ''} transition-all duration-200`}>
                      <div
                        className="font-bold text-center leading-tight px-4 cursor-move"
                        style={{ 
                          fontFamily: fontStyle, 
                          fontSize: `${sizes.title.fontSize}px`,
                          color: textColor?.textColor || 'white',
                          textShadow: textColor?.textShadow || '2px 2px 4px rgba(0,0,0,0.8)'
                        }}
                        onMouseDown={(e) => handleMouseDown('title', e)}
                      >
                        {formData.title}
                      </div>
                      
                      {/* Resize handle */}
                      <div
                        className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        onMouseDown={(e) => handleResizeDown('title', e)}
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${isDragging === 'description' || isResizing === 'description' ? 'z-50' : ''}`}
                    style={{ 
                      left: `${positions.description.x}%`,
                      top: `${positions.description.y}%`
                    }}
                  >
                    <div className={`relative group ${isDragging === 'description' ? 'ring-2 ring-purple-400 ring-opacity-50 shadow-2xl' : ''} ${isResizing === 'description' ? 'ring-2 ring-blue-400 ring-opacity-50' : ''} transition-all duration-200`}>
                      <div
                        className="font-bold text-center leading-tight px-4 cursor-move"
                        style={{ 
                          fontFamily: fontStyle, 
                          fontSize: `${sizes.description.fontSize}px`,
                          color: textColor?.textColor || 'white',
                          textShadow: textColor?.textShadow || '2px 2px 4px rgba(0,0,0,0.8)'
                        }}
                        onMouseDown={(e) => handleMouseDown('description', e)}
                      >
                        {formData.description}
                      </div>
                      <div
                        className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        onMouseDown={(e) => handleResizeDown('description', e)}
                      />
                    </div>
                  </div>

                  {/* SwaySell Link */}
                  <div
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${isDragging === 'swaysell' || isResizing === 'swaysell' ? 'z-50' : ''}`}
                    style={{ 
                      left: `${positions.swaysell.x}%`,
                      top: `${positions.swaysell.y}%`
                    }}
                  >
                    <div className={`relative group ${isDragging === 'swaysell' ? 'ring-2 ring-purple-400 ring-opacity-50 shadow-2xl' : ''} ${isResizing === 'swaysell' ? 'ring-2 ring-blue-400 ring-opacity-50' : ''} transition-all duration-200`}>
                      <div
                        className="font-medium text-center leading-tight px-4 cursor-move"
                        style={{ 
                          fontFamily: fontStyle, 
                          fontSize: `${sizes.swaysell.fontSize}px`,
                          color: textColor?.textColor || 'white',
                          textShadow: textColor?.textShadow || '2px 2px 4px rgba(0,0,0,0.8)'
                        }}
                        onMouseDown={(e) => handleMouseDown('swaysell', e)}
                      >
                        Insert SwaySell Link Here
                      </div>
                      <div
                        className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        onMouseDown={(e) => handleResizeDown('swaysell', e)}
                      />
                    </div>
                  </div>

                  {/* Price */}
                  <div
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${isDragging === 'price' || isResizing === 'price' ? 'z-50' : ''}`}
                    style={{ 
                      left: `${positions.price.x}%`,
                      top: `${positions.price.y}%`
                    }}
                  >
                    <div className={`relative group ${isDragging === 'price' ? 'ring-2 ring-purple-400 ring-opacity-50 shadow-2xl' : ''} ${isResizing === 'price' ? 'ring-2 ring-blue-400 ring-opacity-50' : ''} transition-all duration-200`}>
                      <div
                        className="font-semibold text-center leading-tight px-4 cursor-move"
                        style={{ 
                          fontFamily: fontStyle, 
                          fontSize: `${sizes.price.fontSize}px`,
                          color: textColor?.textColor || 'white',
                          textShadow: textColor?.textShadow || '2px 2px 4px rgba(0,0,0,0.8)'
                        }}
                        onMouseDown={(e) => handleMouseDown('price', e)}
                      >
                        {workflowType === 'single' 
                          ? `Price: ${formData.price}` 
                          : `Price: ${formData.minPrice} - ${formData.maxPrice}`
                        }
                      </div>
                      <div
                        className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        onMouseDown={(e) => handleResizeDown('price', e)}
                      />
                    </div>
                  </div>

                  {/* Non-profit */}
                  <div
                    className={`absolute transform -translate-x-1/2 -translate-y-1/2 ${isDragging === 'nonprofit' || isResizing === 'nonprofit' ? 'z-50' : ''}`}
                    style={{ 
                      left: `${positions.nonprofit.x}%`,
                      top: `${positions.nonprofit.y}%`
                    }}
                  >
                    <div className={`relative group ${isDragging === 'nonprofit' ? 'ring-2 ring-purple-400 ring-opacity-50 shadow-2xl' : ''} ${isResizing === 'nonprofit' ? 'ring-2 ring-blue-400 ring-opacity-50' : ''} transition-all duration-200`}>
                      <div
                        className="font-semibold text-center leading-tight px-4 cursor-move"
                        style={{ 
                          fontFamily: fontStyle, 
                          fontSize: `${sizes.nonprofit.fontSize}px`,
                          color: textColor?.textColor || 'white',
                          textShadow: textColor?.textShadow || '2px 2px 4px rgba(0,0,0,0.8)'
                        }}
                        onMouseDown={(e) => handleMouseDown('nonprofit', e)}
                      >
                        Supporting: {formData['non-profit']}
                      </div>
                      <div
                        className="absolute -bottom-1 -right-1 w-4 h-4 bg-blue-500 border-2 border-white rounded-full cursor-nw-resize opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        onMouseDown={(e) => handleResizeDown('nonprofit', e)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {!prediction && !isLoading && !error && (
              <div className="text-center py-20 text-gray-500">
                <svg className="w-24 h-24 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <p className="text-xl">Your story will appear here</p>
                <p className="text-sm mt-2">Fill out the form and click generate to see the magic!</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden canvas for rendering */}
      <canvas ref={renderCanvasRef} style={{ display: 'none' }} />

      {/* Download Modal */}
      {showDownloadModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 max-w-lg w-full mx-4">
            <h3 className="text-2xl font-bold text-gray-800 mb-4">Download Your Story</h3>
            <p className="text-gray-600 mb-6">
              Choose your platform and whether to include the SwaySell link placeholder.
            </p>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Instagram Options */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700 flex items-center">
                  <span className="w-6 h-6 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full mr-2"></span>
                  Instagram
                </h4>
                <button
                  onClick={() => downloadStory(true, 'instagram')}
                  disabled={isRendering}
                  className="w-full bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isRendering ? 'Rendering...' : 'With SwaySell link'}
                </button>
                <button
                  onClick={() => downloadStory(false, 'instagram')}
                  disabled={isRendering}
                  className="w-full bg-purple-400 hover:bg-purple-500 text-white font-semibold py-3 px-4 rounded-xl transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isRendering ? 'Rendering...' : 'Without SwaySell link'}
                </button>
              </div>

              {/* Facebook Options */}
              <div className="space-y-3">
                <h4 className="font-semibold text-gray-700 flex items-center">
                  <span className="w-6 h-6 bg-blue-500 rounded-full mr-2"></span>
                  Facebook
                </h4>
                <button
                  onClick={() => downloadStory(true, 'facebook')}
                  disabled={isRendering}
                  className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-4 rounded-xl transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isRendering ? 'Rendering...' : 'With SwaySell link'}
                </button>
                <button
                  onClick={() => downloadStory(false, 'facebook')}
                  disabled={isRendering}
                  className="w-full bg-blue-400 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-xl transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isRendering ? 'Rendering...' : 'Without SwaySell link'}
                </button>
              </div>
            </div>
            
            <button
              onClick={() => setShowDownloadModal(false)}
              disabled={isRendering}
              className="w-full mt-6 bg-gray-300 hover:bg-gray-400 text-gray-700 font-semibold py-3 px-6 rounded-xl transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            
            {isRendering && (
              <div className="mt-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-600"></div>
                <span className="ml-2 text-gray-600">Rendering your story...</span>
              </div>
            )}
            
            <div className="mt-4 text-xs text-gray-500 text-center">
              <p>📱 Both formats are 9:16 aspect ratio (540x960px)</p>
              <p>Perfect for Instagram & Facebook Stories</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}