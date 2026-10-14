webemu-development-guide
Comprehensive workflow guidelines, architecture patterns, multiplayer netcode standards, and bug-fixing strategies for developing and maintaining WebEMU. Use when working on codebase features, refactoring modules, or fixing issues in the WebEMU project.

Instructions
WebEMU Development Guide
This skill provides operational guidelines and architectural patterns for maintaining and expanding WebEMU, a browser-based retro gaming and multiplayer emulation platform.

Core Architectural Principles
Multi-Agent Orchestration: Complex requests are broken down by the master orchestrator and routed to specialized modules (Core-Agent, Netplay-Agent, Audio-Agent, Storage-Agent, Input-Agent, UI-Agent).
Strict Separation of Concerns: Emulation core and WebAssembly memory pointers must never bleed directly into UI components. All communication goes through event emitters or clean public controllers.
Defensive Resource Management: Always implement strict lifecycle cleanup (destroy() / cleanup()) to cancel render frames, close WebSockets, terminate WebRTC data channels, and free Wasm pointers.
Subsystem Development Rules
Emulation & WASM Core (src/core/)
Manage framerate (60fps) via requestAnimationFrame decoupled from network packet loops.
Validate ROM hashes (MD5 / CRC32) before initiating cores to ensure determinism across multiplayer clients.
Netplay & Rooms (src/netplay/)
Signaling: Use WebSockets strictly for session handshakes, room creation, and exchanging ICE/SDP candidates.
P2P Transport: Migrate game input streams immediately to WebRTC DataChannels (ordered: false, maxRetransmits: 0).
Netcode: Use input delay combined with lightweight state hash verification (SyncEngine) to prevent and correct desynchronization (desync) in real time.
Audio & Storage (src/audio/, src/storage/)
Audio: Initialize AudioContext only after explicit user interaction. Utilize AudioWorklet to run audio processing off the main thread, preventing audio stuttering.
Storage: Persist ROM files, SRAM (.srm), and save states locally using IndexedDB.