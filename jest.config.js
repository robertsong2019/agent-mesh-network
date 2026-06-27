module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      isolatedModules: true,
      transpileOnly: true,
    }],
  },
  moduleNameMapper: {
    '^@libp2p/kad-dht$': '<rootDir>/tests/__mocks__/empty.js',
    '^@libp2p/identify$': '<rootDir>/tests/__mocks__/empty.js',
    '^@chainsafe/libp2p-gossipsub$': '<rootDir>/tests/__mocks__/empty.js',
    '^@chainsafe/libp2p-noise$': '<rootDir>/tests/__mocks__/empty.js',
    '^@chainsafe/libp2p-yamux$': '<rootDir>/tests/__mocks__/empty.js',
    '^@libp2p/websockets$': '<rootDir>/tests/__mocks__/empty.js',
    '^libp2p$': '<rootDir>/tests/__mocks__/empty.js',
    '^@libp2p/peer-id$': '<rootDir>/tests/__mocks__/empty.js',
  },
};
