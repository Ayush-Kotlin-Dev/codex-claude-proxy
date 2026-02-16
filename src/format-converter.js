/**
 * Format Converter
 * Converts between Anthropic Messages API and OpenAI Responses API format
 */

import crypto from 'crypto';

function extractSystemPrompt(system) {
    if (!system) {
        return undefined;
    }
    
    if (typeof system === 'string') {
        return system;
    }
    
    if (Array.isArray(system)) {
        const textParts = system
            .filter(block => block.type === 'text')
            .map(block => block.text);
        return textParts.join('\n\n') || undefined;
    }
    
    return undefined;
}

/**
 * Convert Anthropic Messages API request to OpenAI Responses API format
 */
export function convertAnthropicToResponsesAPI(anthropicRequest) {
    const { model, messages, system, tools, tool_choice } = anthropicRequest;

    const instructions = extractSystemPrompt(system);

    const request = {
        model: model || 'gpt-5.2-codex',
        input: convertMessagesToInput(messages),
        tools: tools ? convertAnthropicToolsToOpenAI(tools) : [],
        tool_choice: tool_choice || 'auto',
        parallel_tool_calls: true,
        store: false,
        stream: true,
        include: []
    };
    
    if (instructions) {
        request.instructions = instructions;
    } else {
        request.instructions = '';
    }

    return request;
}

/**
 * Convert Anthropic messages to OpenAI Responses API input format
 */
function convertMessagesToInput(messages) {
    if (!Array.isArray(messages)) {
        return [];
    }

    const input = [];

    for (const msg of messages) {
        if (msg.role === 'user') {
            const { textParts, toolResults } = convertUserContent(msg.content);
            
            if (textParts.length > 0) {
                // API accepts: string OR array of {type: 'input_text', text: '...'}
                const content = textParts.length === 1 
                    ? textParts[0]  // Use string for single text
                    : textParts.map(text => ({ type: 'input_text', text }));
                input.push({
                    type: 'message',
                    role: 'user',
                    content
                });
            }
            
            for (const result of toolResults) {
                input.push(result);
            }
        } else if (msg.role === 'assistant') {
            const { textParts, toolCalls } = convertAssistantContentToOpenAI(msg.content);
            
            if (textParts.length > 0) {
                // API accepts: string OR array of {type: 'output_text', text: '...'}
                const content = textParts.length === 1 
                    ? textParts[0]  // Use string for single text
                    : textParts.map(text => ({ type: 'output_text', text }));
                input.push({
                    type: 'message',
                    role: 'assistant',
                    content
                });
            }
            
            for (const call of toolCalls) {
                input.push(call);
            }
        }
    }

    return input;
}

/**
 * Convert user content, separating text and tool results
 */
function convertUserContent(content) {
    const textParts = [];
    const toolResults = [];
    
    if (typeof content === 'string') {
        textParts.push(content);
    } else if (Array.isArray(content)) {
        for (const block of content) {
            if (block.type === 'text') {
                textParts.push(block.text);
            } else if (block.type === 'tool_result') {
                const outputContent = typeof block.content === 'string' 
                    ? block.content 
                    : Array.isArray(block.content)
                        ? block.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                        : JSON.stringify(block.content);
                
                let callId = block.tool_use_id;
                if (!callId.startsWith('fc_') && !callId.startsWith('fc')) {
                    callId = 'fc_' + callId.replace(/^(call_|toolu_)/, '');
                }
                
                toolResults.push({
                    type: 'function_call_output',
                    call_id: callId,
                    output: block.is_error ? `Error: ${outputContent}` : outputContent
                });
            }
        }
    }
    
    return { textParts, toolResults };
}

/**
 * Convert Anthropic assistant content to OpenAI format
 */
function convertAssistantContentToOpenAI(content) {
    const textParts = [];
    const toolCalls = [];
    
    if (typeof content === 'string') {
        textParts.push(content);
    } else if (Array.isArray(content)) {
        for (const block of content) {
            if (block.type === 'text') {
                textParts.push(block.text);
            } else if (block.type === 'tool_use') {
                let callId = block.id;
                if (!callId.startsWith('fc_') && !callId.startsWith('fc')) {
                    callId = 'fc_' + callId.replace(/^(call_|toolu_)/, '');
                }
                
                toolCalls.push({
                    type: 'function_call',
                    id: callId,
                    call_id: callId,
                    name: block.name,
                    arguments: typeof block.input === 'string' 
                        ? block.input 
                        : JSON.stringify(block.input)
                });
            }
        }
    }
    
    return { textParts, toolCalls };
}

/**
 * Convert Anthropic tools to OpenAI function format
 */
function convertAnthropicToolsToOpenAI(tools) {
    if (!Array.isArray(tools)) {
        return [];
    }

    return tools.map(tool => ({
        type: 'function',
        name: tool.name,
        description: tool.description || '',
        parameters: sanitizeSchema(tool.input_schema || { type: 'object' })
    }));
}

function sanitizeSchema(schema) {
    if (typeof schema !== 'object' || schema === null) {
        return { type: 'object' };
    }
    
    const result = {};
    
    for (const [key, value] of Object.entries(schema)) {
        if (key === 'const') {
            result.enum = [value];
            continue;
        }
        
        if ([
            '$schema', '$id', '$ref', '$defs', '$comment',
            'additionalItems', 'definitions', 'examples',
            'minLength', 'maxLength', 'pattern', 'format',
            'minItems', 'maxItems', 'minimum', 'maximum',
            'exclusiveMinimum', 'exclusiveMaximum',
            'allOf', 'anyOf', 'oneOf', 'not'
        ].includes(key)) {
            continue;
        }
        
        if (key === 'additionalProperties' && typeof value === 'boolean') {
            continue;
        }
        
        if (key === 'type' && Array.isArray(value)) {
            const nonNullTypes = value.filter(t => t !== 'null');
            result.type = nonNullTypes.length > 0 ? nonNullTypes[0] : 'string';
            continue;
        }
        
        if (key === 'properties' && value && typeof value === 'object') {
            result.properties = {};
            for (const [propKey, propValue] of Object.entries(value)) {
                result.properties[propKey] = sanitizeSchema(propValue);
            }
            continue;
        }
        
        if (key === 'items') {
            if (Array.isArray(value)) {
                result.items = value.map(item => sanitizeSchema(item));
            } else if (typeof value === 'object') {
                result.items = sanitizeSchema(value);
            } else {
                result.items = value;
            }
            continue;
        }
        
        if (key === 'required' && Array.isArray(value)) {
            result.required = value;
            continue;
        }
        
        if (key === 'enum' && Array.isArray(value)) {
            result.enum = value;
            continue;
        }
        
        if (['type', 'description', 'title'].includes(key)) {
            result[key] = value;
        }
    }
    
    if (!result.type) {
        result.type = 'object';
    }
    
    if (result.type === 'object' && !result.properties) {
        result.properties = {};
    }
    
    return result;
}

/**
 * Convert OpenAI Responses API output to Anthropic content blocks
 */
export function convertOutputToAnthropic(output) {
    if (!Array.isArray(output)) {
        return [{ type: 'text', text: '' }];
    }

    const content = [];
    
    for (const item of output) {
        if (item.type === 'message') {
            for (const part of item.content || []) {
                if (part.type === 'output_text') {
                    content.push({ type: 'text', text: part.text });
                }
            }
        } else if (item.type === 'function_call') {
            let input = {};
            try {
                input = typeof item.arguments === 'string' 
                    ? JSON.parse(item.arguments) 
                    : item.arguments || {};
            } catch (e) {
                input = {};
            }
            
            content.push({
                type: 'tool_use',
                id: item.call_id || item.id,
                name: item.name,
                input: input
            });
        } else if (item.type === 'reasoning') {
            content.push({
                type: 'thinking',
                thinking: '',
                signature: ''
            });
        }
    }

    return content.length > 0 ? content : [{ type: 'text', text: '' }];
}

/**
 * Generate Anthropic message ID
 */
export function generateMessageId() {
    return `msg_${crypto.randomBytes(16).toString('hex')}`;
}

export default {
    convertAnthropicToResponsesAPI,
    convertOutputToAnthropic,
    generateMessageId
};