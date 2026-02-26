const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..', '..');
const CONTEXT_MODULE_PATH = pathToFileURL(
    path.join(ROOT, 'node_modules', '@actions', 'github', 'lib', 'context.js'),
).href;

const scenarios = [
    {
        name: 'fork PR without label skips',
        eventName: 'pull_request',
        fixtureFile: 'fork-missing-label.json',
        expectedExitCode: 0,
        expectedOutputParts: [
            'Pull request does not have the "safe to test" label, skipping.',
        ],
    },
    {
        name: 'fork PR with default label removes via API',
        eventName: 'pull_request_target',
        fixtureFile: 'fork-with-default-label.json',
        expectedExitCode: 0,
        expectedOutputParts: [
            'Removed the "safe to test" label from pull request.',
        ],
        expectedApiCall: {
            method: 'DELETE',
            path: '/repos/base-owner/repo/issues/42/labels/safe%20to%20test',
            authorization: 'token test-token',
            statusCode: 204,
        },
    },
    {
        name: 'fork PR with custom label removes via API',
        eventName: 'pull_request',
        fixtureFile: 'fork-with-custom-label.json',
        inputLabel: 'safe-to-test',
        expectedExitCode: 0,
        expectedOutputParts: [
            'Removed the "safe-to-test" label from pull request.',
        ],
        expectedApiCall: {
            method: 'DELETE',
            path: '/repos/base-owner/repo/issues/7/labels/safe-to-test',
            authorization: 'token test-token',
            statusCode: 204,
        },
    },
    {
        name: 'same repository PR skips',
        eventName: 'pull_request',
        fixtureFile: 'same-repo.json',
        expectedExitCode: 0,
        expectedOutputParts: [
            'Pull request is not from a fork, skipping.',
        ],
    },
    {
        name: 'unsupported event skips',
        eventName: 'push',
        fixtureFile: 'fork-with-default-label.json',
        expectedExitCode: 0,
        expectedOutputParts: [
            'Event "push", skipping. This action only works with the following events: pull_request, pull_request_target.',
        ],
    },
    {
        name: 'invalid payload fails with clear error',
        eventName: 'pull_request',
        fixtureFile: 'invalid-payload.json',
        expectedExitCode: 1,
        expectedOutputParts: [
            'Missing pull request repository metadata in workflow payload.',
        ],
    },
    {
        name: 'missing integration permission fails with clear message',
        eventName: 'pull_request',
        fixtureFile: 'fork-with-default-label.json',
        expectedExitCode: 1,
        expectedOutputParts: [
            'Failed to remove label because the workflow token lacks required permissions.',
        ],
        expectedApiCall: {
            method: 'DELETE',
            path: '/repos/base-owner/repo/issues/42/labels/safe%20to%20test',
            authorization: 'token test-token',
            statusCode: 403,
            responseBody: {
                message: 'Resource not accessible by integration',
            },
        },
    },
    {
        name: 'already removed label race condition is handled',
        eventName: 'pull_request_target',
        fixtureFile: 'fork-with-default-label.json',
        expectedExitCode: 0,
        expectedOutputParts: [
            'Label was removed during the execution of the action, skipping.',
        ],
        expectedApiCall: {
            method: 'DELETE',
            path: '/repos/base-owner/repo/issues/42/labels/safe%20to%20test',
            authorization: 'token test-token',
            statusCode: 404,
            responseBody: {
                message: 'Label does not exist',
            },
        },
    },
];

let failed = 0;

(async () => {
    const mockApi = await startMockApi();

    // Must be set before importing @actions/github so the default base URL is configured correctly.
    process.env.GITHUB_API_URL = mockApi.baseUrl;

    const run = require(path.join(ROOT, 'index.js'));
    const core = await import('@actions/core');
    const github = await import('@actions/github');
    const { Context } = await import(CONTEXT_MODULE_PATH);

    for (const scenario of scenarios) {
        const fixturePath = path.join(__dirname, 'fixtures', scenario.fixtureFile);
        const payload = fs.readFileSync(fixturePath, 'utf8');
        const { eventPath, tempDir } = writeEventPayload(payload);

        const restoreEnv = withScenarioEnv({
            eventName: scenario.eventName,
            eventPath,
            inputLabel: scenario.inputLabel || 'safe to test',
        });

        process.exitCode = 0;
        mockApi.expectedApiCall = scenario.expectedApiCall || null;
        mockApi.calls.length = 0;

        try {
            const githubRuntime = {
                getOctokit: github.getOctokit,
                context: new Context(),
            };

            const output = await captureOutput(async () => {
                await run({ core, github: githubRuntime });
            });

            const exitCode = process.exitCode || 0;
            const codeMatches = exitCode === scenario.expectedExitCode;
            const outputMatches = scenario.expectedOutputParts.every((part) => output.includes(part));
            const apiMatches = validateApiExpectation(scenario, mockApi.calls);

            if (codeMatches && outputMatches && apiMatches.ok) {
                console.log(`PASS: ${scenario.name}`);
                continue;
            }

            failed += 1;
            console.error(`FAIL: ${scenario.name}`);
            if (!codeMatches) {
                console.error(`Expected exit code: ${scenario.expectedExitCode}, actual: ${exitCode}`);
            }
            if (!outputMatches) {
                console.error('Expected output to include:');
                for (const part of scenario.expectedOutputParts) {
                    console.error(`  - ${part}`);
                }
                console.error('Actual combined output:');
                console.error(output.trim());
            }
            if (!apiMatches.ok) {
                console.error(`API assertion failed: ${apiMatches.message}`);
                console.error(`Observed API calls: ${JSON.stringify(mockApi.calls, null, 2)}`);
            }
        } finally {
            restoreEnv();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    }

    await mockApi.stop();

    if (failed > 0) {
        console.error(`\n${failed} e2e scenario(s) failed.`);
        process.exit(1);
    }

    console.log(`\nAll ${scenarios.length} e2e scenarios passed.`);
})();

function withScenarioEnv({ eventName, eventPath, inputLabel }) {
    const previous = {
        GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
        GITHUB_EVENT_NAME: process.env.GITHUB_EVENT_NAME,
        GITHUB_EVENT_PATH: process.env.GITHUB_EVENT_PATH,
        GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY,
        INPUT_LABEL: process.env.INPUT_LABEL,
        'INPUT_REPO-TOKEN': process.env['INPUT_REPO-TOKEN'],
    };

    process.env.GITHUB_ACTIONS = 'true';
    process.env.GITHUB_EVENT_NAME = eventName;
    process.env.GITHUB_EVENT_PATH = eventPath;
    process.env.GITHUB_REPOSITORY = 'base-owner/repo';
    process.env.INPUT_LABEL = inputLabel;
    process.env['INPUT_REPO-TOKEN'] = 'test-token';

    return () => {
        restoreEnvVar('GITHUB_ACTIONS', previous.GITHUB_ACTIONS);
        restoreEnvVar('GITHUB_EVENT_NAME', previous.GITHUB_EVENT_NAME);
        restoreEnvVar('GITHUB_EVENT_PATH', previous.GITHUB_EVENT_PATH);
        restoreEnvVar('GITHUB_REPOSITORY', previous.GITHUB_REPOSITORY);
        restoreEnvVar('INPUT_LABEL', previous.INPUT_LABEL);
        restoreEnvVar('INPUT_REPO-TOKEN', previous['INPUT_REPO-TOKEN']);
    };
}

function restoreEnvVar(name, value) {
    if (value == null) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
}

function captureOutput(runScenario) {
    const stdoutWrite = process.stdout.write.bind(process.stdout);
    const stderrWrite = process.stderr.write.bind(process.stderr);

    let output = '';

    process.stdout.write = (chunk, encoding, callback) => {
        output += normalizeChunk(chunk, encoding);
        if (typeof callback === 'function') {
            callback();
        }
        return true;
    };

    process.stderr.write = (chunk, encoding, callback) => {
        output += normalizeChunk(chunk, encoding);
        if (typeof callback === 'function') {
            callback();
        }
        return true;
    };

    return Promise.resolve()
        .then(runScenario)
        .then(() => output)
        .finally(() => {
            process.stdout.write = stdoutWrite;
            process.stderr.write = stderrWrite;
        });
}

function normalizeChunk(chunk, encoding) {
    if (Buffer.isBuffer(chunk)) {
        return chunk.toString(encoding || 'utf8');
    }

    return String(chunk);
}

function validateApiExpectation(scenario, calls) {
    if (!scenario.expectedApiCall) {
        if (calls.length > 0) {
            return {
                ok: false,
                message: 'expected no API calls but at least one call was observed',
            };
        }

        return { ok: true };
    }

    if (calls.length !== 1) {
        return {
            ok: false,
            message: `expected exactly one API call but got ${calls.length}`,
        };
    }

    const call = calls[0];
    if (call.method !== scenario.expectedApiCall.method) {
        return {
            ok: false,
            message: `expected method ${scenario.expectedApiCall.method}, got ${call.method}`,
        };
    }

    if (call.path !== scenario.expectedApiCall.path) {
        return {
            ok: false,
            message: `expected path ${scenario.expectedApiCall.path}, got ${call.path}`,
        };
    }

    if (call.authorization !== scenario.expectedApiCall.authorization) {
        return {
            ok: false,
            message: `expected authorization ${scenario.expectedApiCall.authorization}, got ${call.authorization}`,
        };
    }

    return { ok: true };
}

function writeEventPayload(payload) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-safe-to-test-label-'));
    const eventPath = path.join(tempDir, 'event.json');
    fs.writeFileSync(eventPath, payload, 'utf8');
    return { eventPath, tempDir };
}

function startMockApi() {
    const state = {
        expectedApiCall: null,
        calls: [],
    };

    const server = http.createServer((req, res) => {
        state.calls.push({
            method: req.method,
            path: req.url,
            authorization: req.headers.authorization || '',
        });

        if (!state.expectedApiCall) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ message: 'Unexpected API call in scenario.' }));
            return;
        }

        res.statusCode = state.expectedApiCall.statusCode;
        if (state.expectedApiCall.responseBody) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(state.expectedApiCall.responseBody));
            return;
        }

        res.end();
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            resolve({
                get expectedApiCall() {
                    return state.expectedApiCall;
                },
                set expectedApiCall(value) {
                    state.expectedApiCall = value;
                },
                calls: state.calls,
                baseUrl: `http://127.0.0.1:${address.port}`,
                stop: () => new Promise((done) => server.close(done)),
            });
        });
    });
}
