/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GoogleGenAI, Chat, GenerateContentResponse, Part } from '@google/genai';
import { marked } from 'marked';

const API_KEY = process.env.API_KEY;

type ChatMode = 'chat' | 'chinToEng' | 'engToChin';

// DOM Elements
const chatDisplay = document.getElementById('chat-display') as HTMLDivElement;
const messageInput = document.getElementById('message-input') as HTMLTextAreaElement;
const inputForm = document.getElementById('input-form') as HTMLFormElement;
const cameraButton = document.getElementById('camera-button') as HTMLButtonElement;
const cameraInput = document.getElementById('camera-input') as HTMLInputElement;
const fileUploadButton = document.getElementById('file-upload-button') as HTMLButtonElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const imagePreviewContainer = document.getElementById('image-preview-container') as HTMLDivElement;
const imagePreview = document.getElementById('image-preview') as HTMLImageElement;
const clearImageButton = document.getElementById('clear-image-button') as HTMLButtonElement;
const loadingIndicator = document.getElementById('loading-indicator') as HTMLDivElement;
const sendButton = document.getElementById('send-button') as HTMLButtonElement;

// Mode Buttons
const modeChatButton = document.getElementById('mode-chat-button') as HTMLButtonElement;
const modeChinToEngButton = document.getElementById('mode-chin-eng-button') as HTMLButtonElement;
const modeEngToChinButton = document.getElementById('mode-eng-chin-button') as HTMLButtonElement;
const modeButtons = [modeChatButton, modeChinToEngButton, modeEngToChinButton];

let ai: GoogleGenAI | null = null;
let chat: Chat | null = null;
let currentImageBase64: string | null = null;
let currentImageMimeType: string | null = null;
let currentMode: ChatMode = 'chat';

const systemInstructions: Record<ChatMode, string> = {
  chat: "If the user asks 'Zeitik ah dah an ser?', you MUST reply with 'A ka ser ni cu 03-05-2025 ni ah a ka ser.' " +
        "Else if the user asks 'Ho nih dah an ser?', you MUST reply with 'Ceuuk nih a ser. A mah cu Hakha peng Loklung khuami a si.' " +
        "For all other interactions, you are Chat AI Vakok, an expert assistant fluent in Hakha Chin. **Always respond in Hakha Chin.** If a user asks in English, respond in Hakha Chin. If a concept is too complex for Hakha Chin and requires English for clarity, you may use English sparingly, but always attempt Hakha Chin first. Your primary language is Hakha Chin. Be friendly and helpful.",
  chinToEng: "You are a specialized translation tool. Your sole task is to accurately translate the provided Hakha Chin text into English. **Output ONLY the English translation.** If an image is provided, describe the image content in English and then translate any accompanying Hakha Chin text into English. If there is no Hakha Chin text with the image, just describe the image in English.",
  engToChin: "You are a specialized translation tool. Your sole task is to accurately translate the provided English text into Hakha Chin. **Output ONLY the Hakha Chin translation.** If an image is provided, describe the image content in Hakha Chin and then translate any accompanying English text into Hakha Chin. If there is no English text with the image, just describe the image in Hakha Chin.",
};

async function displayWelcomeMessage() {
    displayMessage(await marked.parse("Welcome to Chat AI Vakok! How can I help you today?") as string, 'ai');
}

function initializeAI() {
  if (!API_KEY) {
    displayErrorMessage("API Key is missing. Please set the API_KEY environment variable.");
    setControlsDisabled(true);
    return;
  }
  try {
    ai = new GoogleGenAI({ apiKey: API_KEY });
    recreateChatInstance(); // Initial chat instance creation
    setControlsDisabled(false);
  } catch (error) {
    console.error("Failed to initialize AI:", error);
    displayErrorMessage("Failed to initialize AI. Check console for details.");
    setControlsDisabled(true);
  }
}

function recreateChatInstance() {
  if (!ai) return;
  try {
    chat = ai.chats.create({
      model: 'gemini-2.5-flash',
      config: {
        systemInstruction: systemInstructions[currentMode],
      },
    });
     console.log(`Chat instance recreated with mode: ${currentMode} and instruction: ${systemInstructions[currentMode]}`);
  } catch (error) {
    console.error(`Failed to create chat instance for mode ${currentMode}:`, error);
    displayErrorMessage(`Failed to switch AI mode. ${error instanceof Error ? error.message : String(error)}`);
    setControlsDisabled(true); // Disable controls if chat creation fails
  }
}

function setControlsDisabled(disabled: boolean) {
    messageInput.disabled = disabled;
    cameraButton.disabled = disabled;
    fileUploadButton.disabled = disabled;
    sendButton.disabled = disabled;
    modeButtons.forEach(btn => btn.disabled = disabled && !API_KEY); // only fully disable mode buttons if no API key
}


function displayMessage(htmlContent: string, sender: 'user' | 'ai', elementId?: string): HTMLElement {
  let messageElement: HTMLElement;
  if (elementId && document.getElementById(elementId)) {
    messageElement = document.getElementById(elementId)!;
  } else {
    messageElement = document.createElement('div');
    messageElement.classList.add('message', `${sender}-message`);
    if (elementId) {
      messageElement.id = elementId;
    }
    chatDisplay.appendChild(messageElement);
  }
  
  messageElement.innerHTML = htmlContent; 

  chatDisplay.parentElement?.scrollTo({
    top: chatDisplay.parentElement.scrollHeight,
    behavior: 'smooth'
  });
  return messageElement;
}

function displayErrorMessage(message: string) {
  const errorElement = document.createElement('div');
  errorElement.classList.add('message', 'ai-message', 'error-message'); 
  errorElement.textContent = `Error: ${message}`;
  chatDisplay.appendChild(errorElement);
  chatDisplay.parentElement?.scrollTo({ top: chatDisplay.parentElement.scrollHeight, behavior: 'smooth' });
}

function showLoading(isLoading: boolean) {
  loadingIndicator.classList.toggle('hidden', !isLoading);
}

async function handleSendMessage(event?: Event) {
  if (event) event.preventDefault();
  if (!chat) {
    displayErrorMessage("AI Chat is not initialized or failed to set mode.");
    setControlsDisabled(true); // Re-disable if chat is somehow null
    return;
  }

  const text = messageInput.value.trim();
  if (!text && !currentImageBase64) {
    return; 
  }

  const userMessageContent = text ? text : (currentImageBase64 ? "Image attached" : "");
  if (userMessageContent) {
    displayMessage(await marked.parse(userMessageContent) as string, 'user');
  }

  messageInput.value = '';
  messageInput.style.height = 'auto'; 
  const imageToSend = currentImageBase64;
  const mimeTypeToSend = currentImageMimeType;
  clearImagePreview();
  showLoading(true);
  setControlsDisabled(true); // Disable inputs during AI response

  try {
    const parts: Part[] = [];
    if (imageToSend && mimeTypeToSend) {
      parts.push({
        inlineData: {
          mimeType: mimeTypeToSend,
          data: imageToSend.split(',')[1], 
        },
      });
    }
    
    let promptText = text;
    if (parts.length > 0 && !text) { // Image is present, no text
        switch(currentMode) {
            case 'chat': promptText = "Describe this image."; break;
            case 'chinToEng': promptText = "Describe this image in English and translate any relevant text."; break; 
            case 'engToChin': promptText = "Describe this image in Hakha Chin and translate any relevant text."; break; 
        }
    }
    
    if (promptText) { 
        parts.push({ text: promptText });
    }


    if (parts.length === 0) {
        showLoading(false);
        setControlsDisabled(false);
        return;
    }
    
    const stream = await chat.sendMessageStream({ message: parts });
    
    let aiResponseText = '';
    const aiMessageId = `ai-message-${Date.now()}`;
    let aiMessageElement = displayMessage(await marked.parse('...') as string, 'ai', aiMessageId); 

    for await (const chunk of stream) {
      if (chunk.text) {
        aiResponseText += chunk.text;
        aiMessageElement.innerHTML = await marked.parse(aiResponseText) as string;
        chatDisplay.parentElement?.scrollTo({ top: chatDisplay.parentElement.scrollHeight, behavior: 'smooth' });
      }
    }
    if (!aiResponseText && parts.some(p => p.inlineData)) { 
        aiMessageElement.innerHTML = await marked.parse( (currentMode === 'chat' ? "Received the image. How can I help with it?" : "Received image.") ) as string;
    }

  } catch (error) {
    console.error('Error sending message:', error);
    displayErrorMessage(`Failed to get response from AI. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    showLoading(false);
    setControlsDisabled(false);
    messageInput.focus();
  }
}

function handleImageFile(file: File) {
  if (!file.type.startsWith('image/')) {
    displayErrorMessage('Please select an image file.');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageBase64 = e.target?.result as string;
    currentImageMimeType = file.type;
    imagePreview.src = currentImageBase64;
    imagePreviewContainer.classList.remove('hidden');
  };
  reader.onerror = () => {
    displayErrorMessage('Failed to read file.');
    console.error('File reading error:', reader.error);
  };
  reader.readAsDataURL(file);
}

function clearImagePreview() {
  currentImageBase64 = null;
  currentImageMimeType = null;
  imagePreview.src = '#';
  imagePreviewContainer.classList.add('hidden');
  cameraInput.value = '';
  fileInput.value = '';
}

function setActiveModeButton(selectedButton: HTMLButtonElement) {
    modeButtons.forEach(button => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
    });
    selectedButton.classList.add('active');
    selectedButton.setAttribute('aria-pressed', 'true');
}

function handleModeChange(newMode: ChatMode, buttonElement: HTMLButtonElement) {
    if (currentMode === newMode && chat) return; // No change or chat already configured
    currentMode = newMode;
    setActiveModeButton(buttonElement);
    if (ai) { // only recreate if AI is initialized
        recreateChatInstance(); 
        setControlsDisabled(!chat); // Disable if chat instance creation failed
    }
}


// Event Listeners
inputForm.addEventListener('submit', handleSendMessage);

cameraButton.addEventListener('click', () => cameraInput.click());
cameraInput.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    handleImageFile(target.files[0]);
  }
});

fileUploadButton.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    handleImageFile(target.files[0]);
  }
});

clearImageButton.addEventListener('click', clearImagePreview);

modeChatButton.addEventListener('click', () => handleModeChange('chat', modeChatButton));
modeChinToEngButton.addEventListener('click', () => handleModeChange('chinToEng', modeChinToEngButton));
modeEngToChinButton.addEventListener('click', () => handleModeChange('engToChin', modeEngToChinButton));


messageInput.addEventListener('input', () => {
    messageInput.style.height = 'auto'; 
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 100)}px`; // Max height consideration
});

messageInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); 
        handleSendMessage();
    }
});


// Initialize
async function main() {
    await displayWelcomeMessage();
    initializeAI();
    setActiveModeButton(modeChatButton); // Set initial active button
    if (!API_KEY) {
      showLoading(false);
    } else if (!chat) { // If API key exists but chat init failed
        showLoading(false);
    }
}

main();

// Add a specific class for error messages in CSS for better styling
const style = document.createElement('style');
style.textContent = `
  .error-message {
    background-color: light-dark(hsl(0, 70%, 90%), hsl(0, 70%, 30%)) !important;
    color: light-dark(hsl(0, 70%, 30%), hsl(0, 70%, 90%)) !important;
    border: 1px solid light-dark(hsl(0, 70%, 60%), hsl(0, 70%, 50%));
  }
`;
document.head.appendChild(style);