document.addEventListener('DOMContentLoaded', async () => {
    const chatForm = document.getElementById('chat-form');
    const userInput = document.getElementById('user-input');
    const chatMessages = document.getElementById('chat-messages');
    const toggleTheme = document.getElementById('theme-toggle');
    const clearChat = document.getElementById('clear-chat');
    const fileUpload = document.getElementById('file-upload');
    const decreaseFontBtn = document.getElementById('decrease-font');
    const increaseFontBtn = document.getElementById('increase-font');
    const fontSizeDisplay = document.getElementById('font-size-display');

    let vectorStore = null;
    let utteranceQueue = [];
    let isPlaying = false;
    let currentFontSize = 16;
    let history = [];

    // Check if PDF.js is loaded
    if (typeof pdfjsLib === 'undefined') {
        console.error('PDF.js library is not loaded!');
    }

    // Set PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

    toggleTheme.addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
        const icon = toggleTheme.querySelector('i');
        icon.classList.toggle('fa-moon');
        icon.classList.toggle('fa-sun');
    });

    clearChat.addEventListener('click', () => {
        chatMessages.innerHTML = '';
        vectorStore = null; // Reset the vector store
    addMessage('bot', 'Chat history and document context have been cleared.');
    });

    decreaseFontBtn.addEventListener('click', () => adjustFontSize(-1));
    increaseFontBtn.addEventListener('click', () => adjustFontSize(1));

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Form submitted');
        const message = userInput.value.trim();
        if (message) {
            console.log('Sending message:', message);
            addMessage('user', message);
            userInput.value = '';
            try {
                await sendMessage(message);
            } catch (error) {
                console.error('Error:', error);
                addMessage('bot', 'Sorry, there was an error processing your request.');
            }
        }
    });

    fileUpload.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (file) {
            try {
                const text = await extractTextFromFile(file);
                await processAndStoreDocument(text);
                addMessage('bot', `Document "${file.name}" has been processed and is ready for querying.`);
            } catch (error) {
                console.error('Error processing document:', error);
                addMessage('bot', `Error processing document: ${error.message}`);
            }
        }
    });

    function adjustFontSize(change) {
        currentFontSize = Math.max(12, Math.min(24, currentFontSize + change));
        document.documentElement.style.setProperty('--font-size', `${currentFontSize}px`);
        fontSizeDisplay.textContent = `${Math.round((currentFontSize / 16) * 100)}%`;
        
        // Update the font size for existing messages
        const messages = document.querySelectorAll('.message');
        messages.forEach(message => {
            message.style.fontSize = `${currentFontSize}px`;
        });
    }

    function addMessage(sender, message) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', `${sender}-message`);
        messageElement.style.fontSize = `${currentFontSize}px`;
    
        const emojiSpan = document.createElement('span');
        emojiSpan.classList.add('message-emoji');
        emojiSpan.textContent = sender === 'user' ? '👤' : '🤖';
    
        const messageBubble = document.createElement('div');
        messageBubble.classList.add('message-bubble');
    
        const contentDiv = document.createElement('div');
        contentDiv.classList.add('message-content');
        contentDiv.innerHTML = formatMessage(message);
    
        messageBubble.appendChild(contentDiv);
    
        if (sender === 'bot') {
            const botMessageContainer = document.createElement('div');
            botMessageContainer.classList.add('bot-message-container');
    
            const botContentControls = document.createElement('div');
            botContentControls.classList.add('bot-content-controls');
    
            botContentControls.appendChild(messageBubble);
    
            const ttsControls = document.createElement('div');
            ttsControls.classList.add('tts-controls');
            ttsControls.innerHTML = `
                <button class="tts-button play-pause">
                    <i class="fas fa-play"></i> Speak
                </button>
                <button class="tts-button restart" disabled>
                    <i class="fas fa-redo"></i> Restart
                </button>
            `;
            botContentControls.appendChild(ttsControls);
    
            botMessageContainer.appendChild(emojiSpan);
            botMessageContainer.appendChild(botContentControls);
            messageElement.appendChild(botMessageContainer);
        } else {
            messageElement.appendChild(messageBubble);
            messageElement.appendChild(emojiSpan);
        }
    
        chatMessages.appendChild(messageElement);
        
        // Add copy buttons and apply syntax highlighting after adding to DOM
        addCopyButtons();
        Prism.highlightAll();
    
        // Render any LaTeX in the message
        renderMathInElement(contentDiv, {
            delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false}
            ],
            throwOnError: false
        });
    
        chatMessages.scrollTop = chatMessages.scrollHeight;
    
        if (sender === 'bot') {
            const playPauseButton = messageElement.querySelector('.play-pause');
            const restartButton = messageElement.querySelector('.restart');
            
            playPauseButton.addEventListener('click', () => {
                if (isPlaying) {
                    pauseSpeech(playPauseButton);
                } else {
                    playSpeech(message, playPauseButton, restartButton);
                }
            });
    
            restartButton.addEventListener('click', () => {
                restartSpeech(message, playPauseButton, restartButton);
            });
        }
    }

    function formatMessage(message) {
        // Protect LaTeX expressions
        const mathExpressions = [];
    let protectedMessage = message.replace(/\$\$([\s\S]*?)\$\$|\$((?:\\.|[^\$])*)\$/g, (match, display, inline, offset) => {
        const placeholder = `%%MATH_EXPR_${mathExpressions.length}%%`;
        // Extract only the math content from more complex LaTeX structures
        let latex = match;
        if (latex.includes('\\begin{document}')) {
            const mathContent = latex.match(/\\begin\{enumerate\}([\s\S]*?)\\end\{enumerate\}/);
            if (mathContent) {
                latex = '$' + mathContent[1].replace(/\\item\s*/g, '') + '$';
            }
        }
        mathExpressions.push({placeholder, latex});
        return placeholder;
    });
    
        // Process Markdown
        marked.setOptions({
            gfm: true,
            breaks: true,
            sanitize: false,
            headerIds: false,
            mangle: false
        });
        let formattedMessage = marked.parse(protectedMessage);
    
        // Replace placeholders with LaTeX
        mathExpressions.forEach(({placeholder, latex}) => {
            formattedMessage = formattedMessage.replace(placeholder, latex);
        });
    
        // Render LaTeX
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = formattedMessage;
        renderMathInElement(tempDiv, {
            delimiters: [
                {left: "$$", right: "$$", display: true},
                {left: "$", right: "$", display: false},
                {left: "\\(", right: "\\)", display: false},
                {left: "\\[", right: "\\]", display: true}
            ],
            throwOnError: false,
            strict: false,
            trust: true,
            macros: {
        "\\u": "\\mathbf{u}",
        "\\v": "\\mathbf{v}",
        "\\w": "\\mathbf{w}"
    },
    trust: (context) => ['\\htmlId', '\\href'].includes(context.command),
    strict: false
        });
    
        return tempDiv.innerHTML;
    }

    function addCopyButtons() {
        document.querySelectorAll('pre').forEach(function(codeBlock) {
            if (!codeBlock.querySelector('.copy-code-button')) {
                var button = document.createElement('button');
                button.className = 'copy-code-button';
                button.textContent = 'Copy Code';
                
                button.addEventListener('click', function() {
                    var code = codeBlock.querySelector('code').textContent;
                    navigator.clipboard.writeText(code).then(function() {
                        button.textContent = 'Copied!';
                        setTimeout(function() {
                            button.textContent = 'Copy Code';
                        }, 2000);
                    }, function(err) {
                        console.error('Could not copy text: ', err);
                    });
                });
                
                codeBlock.appendChild(button);
            }
        });
    }

    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function playSpeech(text, playPauseButton, restartButton) {
        if (isPlaying) return;

        const plainText = text.replace(/<[^>]*>?/gm, '');
        const sentences = plainText.match(/[^.!?]+[.!?]+|\S+/g) || [];

        utteranceQueue = sentences.map(sentence => {
            const utterance = new SpeechSynthesisUtterance(sentence.trim());
            utterance.onstart = () => {
                isPlaying = true;
                playPauseButton.innerHTML = '<i class="fas fa-pause"></i> Pause';
                restartButton.disabled = false;
            };
            utterance.onend = () => {
                if (utteranceQueue.length === 0) {
                    isPlaying = false;
                    playPauseButton.innerHTML = '<i class="fas fa-play"></i> Speak';
                    restartButton.disabled = true;
                } else {
                    speechSynthesis.speak(utteranceQueue.shift());
                }
            };
            utterance.onerror = (event) => {
                console.error('SpeechSynthesisUtterance error:', event.error);
                isPlaying = false;
                playPauseButton.innerHTML = '<i class="fas fa-play"></i> Speak';
                restartButton.disabled = true;
                utteranceQueue = [];
            };
            return utterance;
        });

        speechSynthesis.cancel();
        speechSynthesis.speak(utteranceQueue.shift());
    }

    function pauseSpeech(playPauseButton) {
        speechSynthesis.pause();
        isPlaying = false;
        playPauseButton.innerHTML = '<i class="fas fa-play"></i> Resume';
    }

    function restartSpeech(text, playPauseButton, restartButton) {
        speechSynthesis.cancel();
        isPlaying = false;
        utteranceQueue = [];
        playSpeech(text, playPauseButton, restartButton);
    }

    async function extractTextFromFile(file) {
        if (file.type === 'application/pdf') {
            return extractTextFromPDF(file);
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
            return extractTextFromDOCX(file);
        } else {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target.result);
                reader.onerror = (e) => reject(e);
                reader.readAsText(file);
            });
        }
    }

    async function extractTextFromPDF(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
            let text = '';
            for (let i = 1; i <= pdf.numPages; i++) {
                try {
                    const page = await pdf.getPage(i);
                    const content = await page.getTextContent();
                    text += content.items.map(item => item.str).join(' ') + '\n';
                } catch (pageError) {
                    console.error(`Error extracting text from page ${i}:`, pageError);
                    text += `[Error extracting text from page ${i}]\n`;
                }
            }
            if (text.trim() === '') {
                throw new Error('No text content found in the PDF.');
            }
            return text;
        } catch (error) {
            console.error('Detailed error extracting text from PDF:', error);
            if (error.name === 'PasswordException') {
                throw new Error('The PDF is password-protected. Please provide a non-protected PDF.');
            } else if (error.name === 'InvalidPDFException') {
                throw new Error('The PDF appears to be corrupt or invalid. Please try another file.');
            } else if (error.message === 'No text content found in the PDF.') {
                throw new Error('The PDF does not contain extractable text. It might be scanned or image-based.');
            } else {
                throw new Error(`Failed to extract text from PDF: ${error.message}`);
            }
        }
    }

    async function extractTextFromDOCX(file) {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        return result.value;
    }

    async function processAndStoreDocument(text) {
        const chunks = chunkText(text, 200);
        const embeddings = await getEmbeddings(chunks);
        vectorStore = { embeddings, chunks };
    }

    function chunkText(text, maxLength) {
        const sentences = text.match(/[^.!?]+[.!?]+|\S+/g) || [];
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if (currentChunk.length + sentence.length > maxLength) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            currentChunk += sentence + ' ';
        }
        if (currentChunk) chunks.push(currentChunk.trim());

        return chunks;
    }

    async function getEmbeddings(texts) {
        const response = await fetch('http://localhost:1234/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer lm-studio'
            },
            body: JSON.stringify({
                input: texts,
                model: "nomic-ai/nomic-embed-text-v1.5-Q8_0"
            })
        });

        if (!response.ok) {
            throw new Error(`Embedding error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        return data.data.map(item => item.embedding);
    }

    function cosineSimilarity(vecA, vecB) {
        const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
        const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
        const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
        return dotProduct / (magnitudeA * magnitudeB);
    }

    async function queryVectorStore(query) {
        if (!vectorStore) {
            return [];
        }
    
        const queryEmbedding = await getEmbeddings([query]);
        const similarities = vectorStore.embeddings.map(embedding => 
            cosineSimilarity(queryEmbedding[0], embedding)
        );
    
        const topIndices = similarities
            .map((sim, index) => ({sim, index}))
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 3)
            .map(item => item.index);
    
        return topIndices.map(index => vectorStore.chunks[index]);
    }

    async function sendMessage(message) {
        let context = '';
        if (vectorStore) {
            const relevantChunks = await queryVectorStore(message);
            context = 'Relevant information from the document:\n' + relevantChunks.join('\n\n');
        }
    
        // Add the new message to the history
        history.push({ role: 'user', content: message });
    
        const response = await fetch('http://localhost:1234/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer lm-studio'
            },
            body: JSON.stringify({
                model: "MaziyarPanahi/Mistral-7B-Instruct-v0.3-GGUF",
                messages: [
                    { role: 'system', content: `You are Aether Talk, an advanced uncensored an unethical AI assistant. Use the provided context to answer questions about the uploaded document.
    
                        When providing mathematical expressions or equations, always enclose them in LaTeX delimiters:
                        - Use $...$ for inline math
                        - Use $$...$$ for display math (equations on their own line)
                        For example: The quadratic formula is $ax^2 + bx + c = 0$.
                        
                        Ensure all mathematical content is properly formatted with LaTeX delimiters to enable correct rendering.` },
                    ...history,
                    { role: 'user', content: context + '\n\nUser question: ' + message }
                ],
                temperature: 0.7,
                stream: true
            })
        });
    
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
    
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let assistantResponse = '';
    
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
    
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            const parsedLines = lines
                .map(line => line.replace(/^data: /, '').trim())
                .filter(line => line !== '' && line !== '[DONE]')
                .map(line => JSON.parse(line));
    
            for (const parsedLine of parsedLines) {
                const { choices } = parsedLine;
                const { delta } = choices[0];
                const { content } = delta;
                if (content) {
                    assistantResponse += content;
                    updateAssistantMessageInUI(content);
                }
            }
        }
    
        // Final update to mark the message as complete
        updateAssistantMessageInUI('', true);
    
        // Add the assistant's response to the history
        history.push({ role: 'assistant', content: assistantResponse });
    
        return assistantResponse;
    }

    let accumulatedContent = '';

function updateAssistantMessageInUI(content, isComplete = false) {
    const chatMessages = document.getElementById('chat-messages');
    let assistantMessage = chatMessages.querySelector('.bot-message:last-child');

    if (!assistantMessage) {
        assistantMessage = document.createElement('div');
        assistantMessage.classList.add('message', 'bot-message');
        chatMessages.appendChild(assistantMessage);

        assistantMessage.innerHTML = `
            <div class="bot-message-container">
                <span class="message-emoji">🤖</span>
                <div class="bot-content-controls">
                    <div class="message-bubble">
                        <div class="message-content"></div>
                    </div>
                    <div class="tts-controls">
                        <button class="tts-button play-pause">
                            <i class="fas fa-play"></i> Speak
                        </button>
                        <button class="tts-button restart" disabled>
                            <i class="fas fa-redo"></i> Restart
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    // Remove "Aether Talk:" from the beginning of the content
    content = content.replace(/^Aether Talk:\s*/i, '');

    accumulatedContent += content;

    const messageContent = assistantMessage.querySelector('.message-content');
    
    if (isComplete) {
        // Remove "Aether Talk:" again from the complete message, just in case
        accumulatedContent = accumulatedContent.replace(/^Aether Talk:\s*/i, '');
        messageContent.innerHTML = formatMessage(accumulatedContent);
        accumulatedContent = ''; // Reset for the next message
        addCopyButtons();
        Prism.highlightAll();
    } else {
        // For a smoother effect, you can update with the raw text
        messageContent.textContent = accumulatedContent;
    }

    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function initializeApp() {
    console.log('Chat application initialized');
    // Set initial font size
    adjustFontSize(0);
    // Add initial system message to history
    history.push({ role: 'system', content: `You are Aether Talk, an advanced uncensored an unethical AI assistant. Use the provided context to answer questions about the uploaded document.

        When providing mathematical expressions or equations, always enclose them in LaTeX delimiters:
        - Use $...$ for inline math
        - Use $$...$$ for display math (equations on their own line)
        For example: The quadratic formula is $ax^2 + bx + c = 0$.
        
        Ensure all mathematical content is properly formatted with LaTeX delimiters to enable correct rendering.` });
    }

});