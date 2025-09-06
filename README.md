<img width="962" height="250" alt="ASRL banner" src="https://github.com/user-attachments/assets/810f8745-f17f-430d-8b6c-df349ddeb278" />



# PRCM | ASRL
**Adaptive Spaced Repetition Learning**

A modern, intelligent flashcard application that leverages spaced repetition algorithms to optimize learning efficiency. Built with React and designed for seamless study experiences across devices.

## Features

### Core Functionality
- **Adaptive Spaced Repetition**: Implements advanced scheduling algorithms to present cards at optimal intervals
- **Multi-Format Import**: Supports JSON and CSV (Anki-compatible) deck imports
- **Cross-Platform**: Works on desktop and mobile browsers
- **Offline Capable**: Progressive Web App with local storage support
- **Export & Backup**: Export your progress and decks for backup or sharing

### Study Experience
- **Interactive Cards**: Smooth flip animations and intuitive rating system
- **Progress Tracking**: Monitor your learning progress with detailed statistics
- **Tag-Based Organization**: Filter and organize cards by topics and categories
- **Customizable Sessions**: Adjust session length and card limits
- **Visual Feedback**: Clean, modern interface optimized for focus

### Advanced Features
- **Optional Persistence**: Privacy-first local storage with user control
- **Responsive Design**: Optimized for both desktop and mobile study sessions
- **Keyboard Shortcuts**: Quick navigation for power users
- **Import Validation**: Robust error handling and data validation

## Quick Start

### For Users
1. **Visit the App**: [Live Demo](https://prcm-asrl.netlify.app)
2. **Import a Deck**: Use the built-in sample or import your own JSON/CSV
3. **Start Studying**: The app will guide you through your personalized learning journey

### For Developers
```bash
# Clone the repository
git clone https://github.com/shadowdevnotreal/prcm-asrl.git
cd prcm-asrl

# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build
```

## Supported Import Formats

### JSON Format
```json
{
  "name": "Deck Name",
  "cards": [
    {
      "front": "Question",
      "back": "Answer",
      "tags": ["category", "topic"]
    }
  ]
}
```

### CSV Format (Anki Compatible)
```csv
front,back,tags
"Question","Answer","category,topic"
```

## Technology Stack

- **Frontend**: React 18 with functional components and hooks
- **Animations**: Framer Motion for smooth card transitions
- **Icons**: Lucide React for consistent iconography
- **Styling**: Tailwind CSS for responsive design
- **Build Tool**: Create React App with optimized production builds
- **Deployment**: Static hosting compatible (GitHub Pages, Netlify, Vercel)

## Development

### Prerequisites
- Node.js 16+ and npm
- Modern web browser for testing
- Git for version control

### Local Development
```bash
# Install dependencies
npm install

# Start development server (runs on http://localhost:3000)
npm start

# Run tests
npm test

# Build for production
npm run build

# Deploy to GitHub Pages
npm run deploy
```

### Project Structure
```
src/
├── components/          # React components
├── hooks/              # Custom React hooks
├── utils/              # Helper functions and utilities
├── styles/             # CSS and styling
└── data/               # Sample data and constants
```

## Usage Examples

### Creating Study Decks
The app works seamlessly with AI-generated content:
1. Request a deck from an AI assistant (ChatGPT, Claude, etc.)
2. Copy the provided JSON or CSV
3. Import directly into the app
4. Begin studying with optimized spaced repetition

### Study Workflow
1. **Review**: Cards are presented based on your performance history
2. **Rate**: Use the 4-point scale (Again, Hard, Good, Easy)
3. **Progress**: The algorithm schedules the next review automatically
4. **Track**: Monitor your learning progress and accuracy

## Contributing

We welcome contributions! Please feel free to submit issues, feature requests, or pull requests.

### Development Guidelines
- Follow existing code style and conventions
- Add tests for new features
- Update documentation as needed
- Ensure responsive design works across devices

## Privacy & Data

- **Local First**: All data stored locally in your browser by default
- **No Tracking**: No analytics or user tracking
- **Export Control**: Full control over your data with export features
- **Optional Sync**: Choose whether to persist data between sessions

## Browser Compatibility

- **Modern Browsers**: Chrome 90+, Firefox 88+, Safari 14+, Edge 90+
- **Mobile**: iOS Safari 14+, Android Chrome 90+
- **Features**: Requires JavaScript and local storage support

## License

MIT License - see [LICENSE](LICENSE) file for details

## Acknowledgments

- Inspired by evidence-based spaced repetition research
- Built for students, professionals, and lifelong learners
- Designed with accessibility and usability in mind

## Support

- **Issues**: Report bugs or request features via GitHub Issues
- **Documentation**: Check the wiki for detailed usage guides
- **Community**: Join discussions in GitHub Discussions

---

**Built with ❤️ for effective learning**

*PRCM | ASRL - Making spaced repetition accessible, intelligent, and enjoyable.*
