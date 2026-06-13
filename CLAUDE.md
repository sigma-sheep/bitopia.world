# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**bitopia.world** is an isometric multiplayer world where humans and AI agents roam together. The project is in early stages and will evolve to support:
- Isometric rendering of game world
- Real-time multiplayer interactions
- AI agent behavior and pathfinding
- Persistent world state
- Human player input and movement

## Architecture Decisions

As the project develops, the expected architecture likely includes:
- **Frontend**: Isometric rendering layer (possibly Babylon.js, Three.js, or Phaser)
- **Backend**: Server managing world state, agent behavior, and multiplayer synchronization
- **AI System**: Agent logic, decision-making, and pathfinding
- **Database**: Persistence for world state and player data

When implementing these systems:
- Keep world state logic decoupled from rendering
- Use event-driven architecture for agent behavior
- Ensure client-server communication is lossy-network-resilient
- Design for horizontal scaling of agents

## Development Setup

Documentation for building, testing, and running the project will be added as structure is established. Common commands to implement:
- Build/bundling the frontend
- Running the development server
- Running backend server
- Running tests
- Linting/formatting

## Code Organization

As the project grows:
- `/src/client` - Frontend isometric rendering and UI
- `/src/server` - Backend game server and world logic
- `/src/shared` - Shared types and utilities
- `/src/agents` - AI agent implementation
- `/tests` - Test suites

## Key Development Principles

1. **World State First**: Design data models around what needs to be persisted and synchronized
2. **Efficient Networking**: Minimize bandwidth for multiplayer sync (delta updates, spatial hashing)
3. **Testable Agents**: AI behavior should be independently testable without rendering
4. **Modular Rendering**: Isometric view should be a view layer, not core logic
5. **Extensible Agent Types**: Design agent system to allow new behaviors without modification

## Dependencies to Consider

- **Rendering**: Babylon.js, Three.js, or Phaser for isometric view
- **Networking**: Socket.io, ws, or WebRTC for real-time multiplayer
- **State Management**: Consider patterns for client-server state consistency
- **Testing**: Jest or Vitest for unit/integration tests
- **Build Tools**: Vite, Webpack, or esbuild
- **AI/Pathfinding**: Consider pathfinding libraries (EasyStar.js, ThetaStar) or implement A*

## Future Documentation

Update CLAUDE.md with:
- Actual project structure once directories are created
- Build and test commands
- Deployment and environment setup
- Architecture deep-dives for complex systems
- Known limitations and architectural decisions
