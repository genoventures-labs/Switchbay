import React, {useState, useEffect, useRef} from 'react';
import {render, Text, Box, Newline, useApp} from 'ink';
import TextInput from 'ink-text-input';
import { Command } from 'commander';
import WebSocket from 'ws';

// --- CLI Configuration ---
const program = new Command();
program
  .name('ori')
  .description('ORI Studio — Terminal Interface')
  .option('-s, --surface <type>', 'Surface context', 'studio')
  .option('-p, --profile <name>', 'Working style', 'big_sister')
  .argument('[query...]', 'One-shot request');

program.parse(process.argv);
const options = program.opts();
const initialQuery = program.args.join(' ');

// --- Constants ---
const API_BASE = process.env.ORI_API_BASE || "https://glm.thynaptic.com/v1";
const WS_BASE = process.env.ORI_WS_BASE || "wss://glm.thynaptic.com/v1/stream";
const API_KEY = process.env.ORI_API_KEY || "glm.Qbtofkny.F5pTIVYghj-mLSwAtPRGDau1q7k2w5DO";

const OriTUI = () => {
	const {exit} = useApp();
	const [query, setQuery] = useState('');
	const [history, setHistory] = useState<{role: string, content: string}[]>([]);
	const [status, setStatus] = useState('CONNECTING');
	const [activeCapability, setActiveCapability] = useState<string | null>(null);
	const [streamingText, setStreamingText] = useState('');
	const wsRef = useRef<WebSocket | null>(null);

	// --- Websocket Heartbeat ---
	useEffect(() => {
		const ws = new WebSocket(WS_BASE);
		wsRef.current = ws;

		ws.on('open', () => {
			setStatus('CONNECTED');
		});

		ws.on('message', (data) => {
			try {
				const evt = JSON.parse(data.toString());
				if (evt.type === 'agent_dispatch') {
					setActiveCapability(evt.action || 'Thinking');
				} else if (evt.type === 'token') {
					setStreamingText(prev => prev + evt.content);
				} else if (evt.type === 'done') {
					setActiveCapability(null);
					setStatus('READY');
				}
			} catch (err) {
				// Ignore malformed heartbeats
			}
		});

		ws.on('close', () => {
			setStatus('DISCONNECTED');
		});

		return () => ws.close();
	}, []);

	// --- Chat Logic ---
	const handleSubmit = async (value: string) => {
		if (!value.trim()) return;
		
		const userMsg = {role: 'user', content: value};
		setHistory(prev => [...prev, userMsg]);
		setQuery('');
		setStatus('THINKING');
		setStreamingText('');

		try {
			const response = await fetch(`${API_BASE}/chat/completions`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${API_KEY}`,
					'X-Ori-Context': options.surface
				},
				body: JSON.stringify({
					model: 'oricli-oracle',
					messages: [...history, userMsg],
					profile: options.profile,
					stream: true
				})
			});

			// If we're not using SSE here (prototype simplicity), 
			// the websocket handles the real-time token stream.
			if (!response.ok) {
				throw new Error(`API Error: ${response.status}`);
			}
		} catch (err) {
			setStatus('ERROR');
			setHistory(prev => [...prev, {role: 'assistant', content: `Sorry honey, backbone's acting up.`}]);
		}
	};

	// --- One-Shot Execution ---
	useEffect(() => {
		if (initialQuery) {
			handleSubmit(initialQuery);
		}
	}, []);

	return (
		<Box flexDirection="column" padding={1} width={100} borderStyle="round" borderColor="yellow">
			{/* Header */}
			<Box justifyContent="space-between" marginBottom={1}>
				<Text color="yellow" bold> ORI Studio (v2.10.0) </Text>
				<Box>
					<Text color="gray">Surface: </Text>
					<Text color="cyan">{options.surface} </Text>
					<Text color="gray">Profile: </Text>
					<Text color="magenta">{options.profile}</Text>
				</Box>
			</Box>

			{/* Chat Feed */}
			<Box flexDirection="column" marginBottom={1} minHeight={15}>
				{history.map((msg, i) => (
					<Box key={i} marginBottom={1}>
						<Text bold color={msg.role === 'user' ? 'cyan' : 'magenta'}>
							{msg.role === 'user' ? 'You: ' : 'ORI: '}
						</Text>
						<Text color="white" wrap="wrap">
							{msg.content}
						</Text>
					</Box>
				))}
				{(streamingText || activeCapability) && (
					<Box flexDirection="column">
						{activeCapability && (
							<Box marginBottom={1}>
								<Text color="yellow" italic>◒ ORI is using: {activeCapability}...</Text>
							</Box>
						)}
						<Box>
							<Text bold color="magenta">ORI: </Text>
							<Text color="white">{streamingText}</Text>
						</Box>
					</Box>
				)}
			</Box>

			{/* Status Bar */}
			<Box borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1} justifyContent="space-between">
				<Box>
					<Text color="gray">Status: </Text>
					<Text color={status === 'READY' || status === 'CONNECTED' ? 'green' : 'yellow'} bold>{status}</Text>
				</Box>
				{activeCapability && <Text color="yellow" bold>AGENT_ACTIVE</Text>}
			</Box>

			{/* Input Box */}
			{!initialQuery && (
				<Box>
					<Text color="yellow" bold>Ask anything: </Text>
					<TextInput 
						value={query} 
						onChange={setQuery} 
						onSubmit={handleSubmit}
					/>
				</Box>
			)}

			<Newline />
			<Text color="gray" dimColor>
				{initialQuery ? 'One-shot mode. Ctrl+C to exit.' : 'Type your request and press Enter. Ctrl+C to exit.'}
			</Text>
		</Box>
	);
};

render(<OriTUI />);
