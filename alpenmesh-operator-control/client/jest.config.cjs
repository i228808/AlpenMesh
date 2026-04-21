module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  transform: {
    '^.+\\.(js|jsx)$': 'babel-jest',
  },
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy',
  },
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/pages/AlertsPage.jsx',
    'src/pages/CongestionLogs.jsx',
    'src/pages/AccidentLogs.jsx',
    'src/pages/Login.jsx',
    'src/pages/Register.jsx',
    'src/components/ui/Sidebar.jsx',
  ],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
