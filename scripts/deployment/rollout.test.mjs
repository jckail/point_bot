import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertApprovedBackup, assertUpgradePreservesResources, contextFromEnvironment, migrationRegistration, recordRolloutFailure, rollout } from './rollout.mjs';
const account = '123456789012', region = 'us-east-1', assetHash = 'a'.repeat(64), webHash = 'b'.repeat(64), templateHash = '9'.repeat(64), digest = `sha256:${'c'.repeat(64)}`, expectedHash = 'd'.repeat(64);
const ecsArn = resource => `arn:aws:ecs:${region}:${account}:${resource}`;
const role = name => `arn:aws:iam::${account}:role/TemplateApp-${name}`;
const dbSecret = `arn:aws:secretsmanager:${region}:${account}:secret:TemplateApp-db-AbCdEf`;
const definition = { taskDefinitionArn: ecsArn('task-definition/TemplateAppMigration:1'), family: 'TemplateAppMigration', executionRoleArn: role('Execution'), taskRoleArn: role('Task'), cpu: '256', memory: '512', networkMode: 'awsvpc', requiresCompatibilities: ['FARGATE'], containerDefinitions: [{ name: 'Migrate', essential: true, image: 'old', command: ['migrate'], logConfiguration: { logDriver: 'awslogs', options: { 'awslogs-region': region, 'awslogs-group': '/migration', 'awslogs-stream-prefix': 'migrate' } }, secrets: Object.entries({ DB_HOST: 'host', DB_PORT: 'port', DB_USER: 'username', DB_PASSWORD: 'password', DB_NAME: 'dbname' }).map(([name, key]) => ({ name, valueFrom: `${dbSecret}:${key}::` })).concat({ name: 'CLERK_SECRET_KEY', valueFrom: 'unrelated' }), environment: [{ name: 'POINTUP_DEV_TOKEN', value: 'must-not-survive' }] }] };
const env = { AWS_REGION: region, WEB_CERTIFICATE_ARN: `arn:aws:acm:${region}:${account}:certificate/${'e'.repeat(8)}-${'e'.repeat(4)}-${'e'.repeat(4)}-${'e'.repeat(4)}-${'e'.repeat(12)}`, WEB_DOMAIN_NAME: 'pointup.test', CLERK_PUBLISHABLE_KEY: 'pk_live_synthetic_offline_fixture', GITHUB_SHA: 'f'.repeat(40), APPROVED_DATABASE_SNAPSHOT_ARN: `arn:aws:rds:${region}:${account}:snapshot:approved-release` };
function harness(options = {}) {
  const files = new Map(), calls = [];
  let stackLookups = 0, changeSetName, bootstrapExecuted = false;
  const stackId = `arn:aws:cloudformation:${region}:${account}:stack/TemplateApp/new-stack`;
  const root = '/fixture', assembly = '/fixture/infra/cdk.out-release', inactive = '/fixture/infra/cdk.out-bootstrap';
  function synth(directory, dark) {
    files.set(resolve(directory, 'manifest.json'), { artifacts: { TemplateApp: { type: 'aws:cloudformation:stack', properties: { templateFile: 'TemplateApp.template.json', stackTemplateAssetObjectUrl: `s3://cdk-files/${templateHash}.json` } }, Assets: { type: 'cdk:asset-manifest', properties: { file: 'TemplateApp.assets.json' } } } });
    const destination = id => ({ region, repositoryName: 'cdk-assets', imageTag: id, assumeRoleArn: `arn:aws:iam::${account}:role/cdk-image-publishing` });
    files.set(resolve(directory, 'TemplateApp.assets.json'), { files: { [templateHash]: { source: { path: 'TemplateApp.template.json', packaging: 'file' }, destinations: { main: { region, bucketName: 'cdk-files', objectKey: `${templateHash}.json`, assumeRoleArn: `arn:aws:iam::${account}:role/cdk-file-publishing` } } } }, dockerImages: { [assetHash]: { source: { directory: 'asset.worker', dockerFile: 'Dockerfile.worker' }, destinations: { main: destination(assetHash) } }, [webHash]: { source: { directory: 'asset.web' }, destinations: { main: destination(webHash) } } } });
    files.set(resolve(directory, 'TemplateApp.template.json'), { Resources: { Migration: { Type: 'AWS::ECS::TaskDefinition', Properties: { ContainerDefinitions: [{ Name: 'Migrate', Image: `candidate:${assetHash}` }] } }, Web: { Type: 'AWS::ECS::TaskDefinition', Properties: { ContainerDefinitions: [{ Name: 'Web', Image: `candidate:${webHash}` }] } }, Service: { Type: 'AWS::ECS::Service', Properties: { DesiredCount: dark ? 0 : 2 } }, Schedule: { Type: 'AWS::Events::Rule', Properties: { State: dark ? 'DISABLED' : 'ENABLED' } }, Scaling: { Type: 'AWS::ApplicationAutoScaling::ScalableTarget', Properties: { MinCapacity: dark ? 0 : 2, MaxCapacity: dark ? 0 : 6 } } } });
  }
  const outputs = { ClusterArn: ecsArn('cluster/TemplateApp'), MigrationTaskDefinitionArn: definition.taskDefinitionArn, MigrationSubnetIds: 'subnet-abc,subnet-def', MigrationSecurityGroupId: 'sg-abc', DatabaseSecretArn: dbSecret, DeploymentPhase: options.firstCreate || options.inactive ? 'inactive-bootstrap' : 'active' };
  const run = async (command, args) => {
    calls.push({ command, args });
    if (command.endsWith('/cdk')) {
      if (args[0] === 'synth') synth(args[args.indexOf('--output') + 1], args.includes('bootstrapInactive=true'));
      if (args.includes('prepare-change-set')) changeSetName = args[args.indexOf('--change-set-name') + 1];
      return '';
    }
    if (command.endsWith('/cdk-assets')) {
      calls.at(-1).publishedManifest = structuredClone(files.get(args[args.indexOf('--path') + 1]));
      calls.at(-1).publishedTemplate = structuredClone(files.get(resolve(args[args.indexOf('--path') + 1], '..', 'TemplateApp.template.json')));
      return '';
    }
    assert.equal(command, 'aws');
    const action = `${args[0]}:${args[1]}`;
    if (options.failAction === action) throw new Error('synthetic command rejection');
    let value;
    switch (action) {
      case 'sts:get-caller-identity': value = { Account: account }; break;
      case 'cloudformation:list-stacks': stackLookups++; value = options.ambiguous ? {} : { StackSummaries: options.firstCreate && !(options.stackAppears && stackLookups > 1) ? [] : [{ StackName: 'TemplateApp', StackStatus: 'UPDATE_COMPLETE' }] }; break;
      case 'cloudformation:get-template': value = { TemplateBody: structuredClone(files.get(resolve(assembly, 'TemplateApp.template.json'))) }; break;
      case 'cloudformation:describe-change-set': value = { ChangeSetId: `arn:aws:cloudformation:${region}:${account}:changeSet/${changeSetName}/unique`, StackId: stackId, Status: 'CREATE_COMPLETE', ExecutionStatus: 'AVAILABLE', Changes: Object.keys(files.get(resolve(inactive, 'TemplateApp.template.json')).Resources).map(LogicalResourceId => ({ Type: 'Resource', ResourceChange: { Action: options.changeSetUpdate ? 'Modify' : 'Add', LogicalResourceId } })) }; break;
      case 'cloudformation:execute-change-set': bootstrapExecuted = true; value = {}; break;
      case 'cloudformation:wait': return '';
      case 'cloudformation:describe-stacks': value = { Stacks: [{ StackId: stackId, StackStatus: args.includes(stackId) ? (options.stackAppearsDuringPrepare ? 'UPDATE_COMPLETE' : bootstrapExecuted ? 'CREATE_COMPLETE' : 'REVIEW_IN_PROGRESS') : 'UPDATE_COMPLETE', Outputs: Object.entries({ ...outputs, ...options.outputs }).map(([OutputKey, OutputValue]) => ({ OutputKey, OutputValue })) }] }; break;
      case 'ecr:describe-images': value = { imageDetails: [{ imageDigest: options.badDigest ? 'mutable-tag' : digest }] }; break;
      case 'ec2:describe-subnets': value = { Subnets: ['subnet-abc', 'subnet-def'].map(SubnetId => ({ SubnetId, OwnerId: account, State: 'available', MapPublicIpOnLaunch: false, VpcId: 'vpc-abc' })) }; break;
      case 'ec2:describe-security-groups': value = { SecurityGroups: [{ OwnerId: account, VpcId: options.foreignVpc ? 'vpc-other' : 'vpc-abc' }] }; break;
      case 'ecs:describe-clusters': value = { clusters: [{ clusterArn: outputs.ClusterArn, status: 'ACTIVE' }] }; break;
      case 'ecs:describe-task-definition': value = { taskDefinition: options.definition ?? structuredClone(definition) }; break;
      case 'cloudformation:list-stack-resources': value = { StackResourceSummaries: [{ ResourceType: 'AWS::RDS::DBInstance', PhysicalResourceId: 'pointup-db' }] }; break;
      case 'rds:describe-db-instances': value = { DBInstances: [{ DBInstanceIdentifier: 'pointup-db', DbiResourceId: 'db-resource', DBInstanceArn: `arn:aws:rds:${region}:${account}:db:pointup-db`, DBInstanceStatus: 'available', StorageEncrypted: true, DBSubnetGroup: { VpcId: 'vpc-abc' } }] }; break;
      case 'rds:describe-db-snapshots': value = { DBSnapshots: [{ DBSnapshotArn: env.APPROVED_DATABASE_SNAPSHOT_ARN, DBInstanceIdentifier: 'pointup-db', DbiResourceId: 'db-resource', Status: 'available', Encrypted: true, SnapshotCreateTime: new Date().toISOString() }] }; break;
      case 'ecs:stop-task': value = {}; break;
      case 'secretsmanager:describe-secret': value = { ARN: dbSecret }; break;
      case 'ecs:register-task-definition': value = { taskDefinition: { taskDefinitionArn: ecsArn('task-definition/TemplateAppMigration:2') } }; break;
      case 'ecs:run-task': value = options.launchFailure ? { failures: [{ reason: 'synthetic' }], tasks: [] } : options.missingTask ? { tasks: [] } : { tasks: [{ taskArn: ecsArn('task/TemplateApp/task-one') }] }; break;
      case 'ecs:wait': return '';
      case 'ecs:describe-tasks': value = { tasks: [{ taskArn: ecsArn('task/TemplateApp/task-one'), taskDefinitionArn: ecsArn('task-definition/TemplateAppMigration:2'), lastStatus: 'STOPPED', containers: [{ name: 'Migrate', imageDigest: digest, ...(options.missingExit ? {} : { exitCode: options.exitCode ?? 0 }) }] }] }; break;
      case 'logs:get-log-events': value = { events: [{ message: JSON.stringify({ component: 'pointup_migrations', event: 'journal_verified', schemaVerified: !options.missingSchemaProof, manifestSha256: options.wrongProof ? 'e'.repeat(64) : expectedHash, migrationCount: 1 }) }] }; break;
      default: throw new Error(`Unexpected offline action ${action}`);
    }
    return JSON.stringify(value);
  };
  return { calls, files, assembly, inactive, args: { env: { ...env, ...options.env }, root, run, readJson: path => structuredClone(files.get(path)), saveJson: (path, value) => files.set(path, structuredClone(value)), makeDirectory: () => {}, pause: async () => {}, manifest: () => ({ manifest: { version: 1, files: [{ path: 'meta/_journal.json', sha256: 'a' }, { path: '0000_fixture.sql', sha256: 'b' }] }, sha256: expectedHash }) } };
}
const deploys = fixture => fixture.calls.filter(call => call.command.endsWith('/cdk') && call.args[0] === 'deploy');
test('verification-only makes zero AWS or local publisher calls', async () => {
  const fixture = harness({ env: { VERIFY_ONLY: 'true' } });
  assert.deepEqual(await rollout(fixture.args), { phase: 'verification-only' }); assert.equal(fixture.calls.length, 0);
});
test('upgrade publishes and verifies exact task/journal before activating same digest-pinned assembly', async () => {
  const fixture = harness(); assert.equal((await rollout(fixture.args)).phase, 'activated');
  assert.equal(deploys(fixture).length, 1); assert.ok(deploys(fixture)[0].args.includes(fixture.assembly));
  const proof = fixture.calls.findIndex(call => call.args[0] === 'logs'); const deploy = fixture.calls.findIndex(call => call.args[0] === 'deploy'); assert.ok(proof < deploy);
  const template = fixture.files.get(resolve(fixture.assembly, 'TemplateApp.template.json'));
  for (const id of ['Migration', 'Web']) assert.match(template.Resources[id].Properties.ContainerDefinitions[0].Image, /@sha256:/);
  const fileHash = createHash('sha256').update(JSON.stringify(template, null, 2)).digest('hex');
  const manifest = fixture.files.get(resolve(fixture.assembly, 'manifest.json'));
  const files = fixture.files.get(resolve(fixture.assembly, 'TemplateApp.assets.json')).files;
  assert.equal(manifest.artifacts.TemplateApp.properties.stackTemplateAssetObjectUrl, `s3://cdk-files/${fileHash}.json`);
  assert.equal(files[templateHash], undefined); assert.equal(files[fileHash].destinations.main.objectKey, `${fileHash}.json`);
  assert.equal(files[fileHash].destinations.main.assumeRoleArn, `arn:aws:iam::${account}:role/cdk-file-publishing`);
  const publications = fixture.calls.filter(call => call.command.endsWith('/cdk-assets'));
  assert.equal(publications.length, 2);
  assert.ok(publications[0].publishedManifest.files[templateHash]);
  assert.ok(publications[1].publishedManifest.files[fileHash]);
  assert.equal(publications[1].publishedTemplate.Resources.Web.Properties.ContainerDefinitions[0].Image, template.Resources.Web.Properties.ContainerDefinitions[0].Image);
  const registration = fixture.files.get(resolve(fixture.assembly, 'migration-registration.json'));
  assert.deepEqual(registration.tags, [{ key: 'pointup:stack', value: 'TemplateApp' }, { key: 'pointup:purpose', value: 'migration' }]);
  assert.equal(registration.executionRoleArn, definition.executionRoleArn); assert.equal(registration.containerDefinitions[0].secrets.length, 5);
  assert.ok(!JSON.stringify(registration).includes('must-not-survive'));
});
test('first creation prepares and executes exact CREATE stub with zero hosts, then stays inactive', async () => {
  const fixture = harness({ firstCreate: true, env: { BOOTSTRAP_READY: 'true' } }); assert.equal((await rollout(fixture.args)).phase, 'inactive-awaiting-secret-readiness');
  assert.equal(deploys(fixture).length, 1); assert.ok(deploys(fixture)[0].args.includes(fixture.inactive));
  const execute = fixture.calls.find(call => call.args[1] === 'execute-change-set');
  assert.match(execute.args[execute.args.indexOf('--change-set-name') + 1], /:changeSet\/pointup-bootstrap-[a-f0-9-]+\/unique$/);
  assert.equal(fixture.files.get(resolve(fixture.assembly, 'pointup-release.json')).phase, 'inactive-awaiting-secret-readiness');
  const template = fixture.files.get(resolve(fixture.inactive, 'TemplateApp.template.json')); assert.equal(template.Resources.Service.Properties.DesiredCount, 0); assert.equal(template.Resources.Schedule.Properties.State, 'DISABLED');
});
test('existing inactive bootstrap needs explicit subsequent operator readiness', async () => {
  const fixture = harness({ inactive: true }); assert.equal((await rollout(fixture.args)).phase, 'inactive-awaiting-secret-readiness'); assert.equal(deploys(fixture).length, 0);
  const ready = harness({ inactive: true, env: { BOOTSTRAP_READY: 'true' } }); assert.equal((await rollout(ready.args)).phase, 'activated');
  assert.ok(!ready.calls.some(call => call.args.includes('bootstrapInactive=true')));
});
for (const options of [{ ambiguous: true }, { stackAppears: true, firstCreate: true }, { badDigest: true }, { foreignVpc: true }, { outputs: { ClusterArn: `arn:aws:ecs:${region}:000000000000:cluster/foreign` } }, { launchFailure: true }, { missingTask: true }, { missingExit: true }, { exitCode: 1 }, { wrongProof: true }, { missingSchemaProof: true }, { failAction: 'ecs:wait' }, { failAction: 'cloudformation:list-stacks' }, { env: { APPROVED_DATABASE_SNAPSHOT_ARN: '' } }]) {
  test(`fail closed before candidate activation: ${JSON.stringify(options)}`, async () => { const fixture = harness(options); await assert.rejects(rollout(fixture.args)); assert.equal(deploys(fixture).length, 0); });
}
test('unsupported task containers/roles/secret selectors are refused without mutation', () => {
  for (const mutate of [value => value.containerDefinitions.push({ name: 'Unexpected' }), value => value.taskRoleArn = `arn:aws:iam::${account}:role/foreign`, value => value.containerDefinitions[0].secrets[0].valueFrom = `${dbSecret}:password::`]) {
    const value = structuredClone(definition); mutate(value); assert.throws(() => migrationRegistration(value, 'candidate', { account, region }, expectedHash));
  }
});
test('production config refuses missing build key and preserves explicit Agents/SIWC/MCP options', () => {
  assert.throws(() => contextFromEnvironment({ ...env, CLERK_PUBLISHABLE_KEY: '' }));
  const context = contextFromEnvironment({ ...env, ENABLE_AGENTS: 'true', ASSISTANT_MODEL: 'approved-model', ASSISTANT_TRACING_ENABLED: 'true', ENABLE_CHATGPT_LINKING: 'true', CHATGPT_CLIENT_ID: 'approved', CHATGPT_REDIRECT_URI: 'https://pointup.test/api/auth/chatgpt/callback', CHATGPT_CLIENT_AUTH_METHOD: 'none', ENABLE_MCP: 'true', MCP_CERTIFICATE_ARN: env.WEB_CERTIFICATE_ARN, MCP_DOMAIN_NAME: 'mcp.pointup.test' });
  for (const option of ['enableAgents=true', 'assistantTracing=true', 'enableChatGptLinking=true', 'chatGptClientAuthMethod=none', 'enableMcp=true']) assert.ok(context.includes(option));
});
test('workflow retains complete reusable CI and verification-only configuration gate', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /uses: \.\/\.github\/workflows\/ci\.yml/); assert.match(workflow, /needs: \[check-config, verify\]/); assert.match(workflow, /VERIFY_ONLY.*inputs.verify_only/);
  assert.match(workflow, /environment: production/); assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /run: node ..\/scripts\/deployment\/rollout.mjs/);
  assert.doesNotMatch(workflow, /^\s+run:.*npx cdk deploy/m); assert.ok(!workflow.includes('aws ecs run-task'));
});

test('upgrade refuses unexplained resource removals, type replacement and protected database changes', () => {
  const before = { Resources: { Database: { Type: 'AWS::RDS::DBInstance', Properties: { Engine: 'postgres', DBName: 'app' } }, LegacyBot: { Type: 'AWS::ECS::Service' } } };
  for (const mutate of [value => delete value.Resources.LegacyBot, value => value.Resources.Database.Type = 'AWS::RDS::DBCluster', value => value.Resources.Database.Properties.DBName = 'different']) {
    const next = structuredClone(before); mutate(next); assert.throws(() => assertUpgradePreservesResources(before, next));
  }
  assert.doesNotThrow(() => assertUpgradePreservesResources(before, structuredClone(before)));
});

test('backup gate refuses stale, incomplete, unencrypted or other-database snapshots', () => {
  const database = { DBInstanceIdentifier: 'pointup-db', DbiResourceId: 'db-resource' };
  const now = new Date('2026-10-02T00:00:00Z');
  const snapshot = { DBSnapshotArn: env.APPROVED_DATABASE_SNAPSHOT_ARN, ...database, Status: 'available', Encrypted: true, SnapshotCreateTime: now.toISOString() };
  assert.doesNotThrow(() => assertApprovedBackup(snapshot, database, { account, region }, now));
  for (const change of [{ Status: 'creating' }, { Encrypted: false }, { DbiResourceId: 'different' }, { SnapshotCreateTime: '2026-09-01T00:00:00Z' }, { SnapshotCreateTime: '2027-01-01T00:00:00Z' }]) assert.throws(() => assertApprovedBackup({ ...snapshot, ...change }, database, { account, region }, now));
});

for (const options of [{ stackAppearsDuringPrepare: true }, { changeSetUpdate: true }, { failAction: 'cloudformation:wait' }]) {
  test(`bootstrap never falls back to update after failed CREATE-only gate: ${JSON.stringify(options)}`, async () => {
    const fixture = harness({ firstCreate: true, ...options });
    await assert.rejects(rollout(fixture.args));
    assert.equal(deploys(fixture).length, 1);
    assert.ok(deploys(fixture)[0].args.includes('prepare-change-set'));
    assert.ok(!fixture.calls.some(call => call.args[0] === 'ecs' && call.args[1] === 'run-task'));
    if (!options.failAction) assert.ok(!fixture.calls.some(call => call.args[1] === 'execute-change-set'));
    assert.equal(fixture.files.get(resolve(fixture.assembly, 'pointup-release.json')).phase, options.failAction ? 'bootstrap-creating' : 'bootstrap-prepared');
  });
}
test('migration wait failure retains safe task and log references for diagnosis', async () => {
  const fixture = harness({ failAction: 'ecs:wait' });
  await assert.rejects(rollout(fixture.args));
  const receipt = fixture.files.get(resolve(fixture.assembly, 'pointup-release.json'));
  assert.equal(receipt.phase, 'migration-running'); assert.equal(receipt.migrationTaskArn, ecsArn('task/TemplateApp/task-one'));
  assert.equal(receipt.migrationLogStream, 'migrate/Migrate/task-one');
  assert.ok(fixture.calls.some(call => call.args[1] === 'stop-task'));
  assert.ok(!JSON.stringify(receipt).includes('DB_PASSWORD'));
});

test('optional Bot, aggregator and digest settings preserve explicit production configuration', () => {
  const context = contextFromEnvironment({ ...env, ENABLE_BOT: 'true', BOT_CERTIFICATE_ARN: env.WEB_CERTIFICATE_ARN, BOT_DOMAIN_NAME: 'bot.pointup.test', BOT_DEFAULT_USER_ID: 'user_fixture', ENABLE_AGGREGATOR: 'true', AGGREGATOR_API_URL: 'https://api.vendor.test/v1', DIGEST_FROM_EMAIL: 'digest@pointup.test' });
  for (const option of ['enableBot=true', `botCertificateArn=${env.WEB_CERTIFICATE_ARN}`, 'botDomainName=bot.pointup.test', 'botDefaultUserId=user_fixture', 'enableAggregator=true', 'aggregatorApiUrl=https://api.vendor.test/v1', 'digestFromEmail=digest@pointup.test']) assert.ok(context.includes(option));
  for (const options of [{ ENABLE_BOT: 'yes' }, { ENABLE_BOT: 'true' }, { ENABLE_AGGREGATOR: 'true' }, { ENABLE_AGGREGATOR: 'true', AGGREGATOR_API_URL: 'http://api.vendor.test' }, { ENABLE_AGGREGATOR: 'true', AGGREGATOR_API_URL: 'https://secret@api.vendor.test' }]) assert.throws(() => contextFromEnvironment({ ...env, ...options }));
});

test('failed release receipt retains safe progress without exception details', () => {
  const fixture = harness({ env: {} }); const path = resolve(fixture.assembly, 'pointup-release.json');
  fixture.files.set(path, { version: 1, phase: 'migration-running', migrationTaskArn: ecsArn('task/TemplateApp/task-one') });
  recordRolloutFailure(path, fixture.args.readJson, fixture.args.saveJson);
  assert.deepEqual(fixture.files.get(path), { version: 1, phase: 'failed', lastRecordedPhase: 'migration-running', failureCode: 'DEPLOYMENT_ABORTED', migrationTaskArn: ecsArn('task/TemplateApp/task-one') });
  assert.doesNotThrow(() => recordRolloutFailure(path, () => { throw new Error('synthetic unreadable receipt'); }, fixture.args.saveJson));
});
