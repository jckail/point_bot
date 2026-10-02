import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(message); };
function required(value, message) { if (typeof value !== 'string' || !value.trim()) fail(message); return value; }
function check(condition, message) { if (!condition) fail(message); }
export function contextFromEnvironment(env) {
  check(/^pk_live_[A-Za-z0-9_-]+$/.test(env.CLERK_PUBLISHABLE_KEY ?? ''), 'A production-format Clerk publishable build key is required');
  for (const flag of ['ENABLE_BOT', 'ENABLE_AGGREGATOR', 'ENABLE_AGENTS', 'ASSISTANT_TRACING_ENABLED', 'ENABLE_CHATGPT_LINKING', 'ENABLE_MCP', 'BOOTSTRAP_READY']) check(!env[flag] || ['true', 'false'].includes(env[flag]), 'Deployment flags must be explicit booleans');
  const context = ['-c', `webCertificateArn=${required(env.WEB_CERTIFICATE_ARN, 'Web TLS certificate is required')}`, '-c', `webDomainName=${required(env.WEB_DOMAIN_NAME, 'Web domain is required')}`];
  if (env.DIGEST_FROM_EMAIL) context.push('-c', `digestFromEmail=${env.DIGEST_FROM_EMAIL}`);
  if (env.ENABLE_BOT === 'true') {
    context.push('-c', 'enableBot=true');
    for (const [variable, key] of [['BOT_CERTIFICATE_ARN', 'botCertificateArn'], ['BOT_DOMAIN_NAME', 'botDomainName']]) context.push('-c', `${key}=${required(env[variable], 'Bot TLS configuration is required')}`);
    if (env.BOT_DEFAULT_USER_ID) context.push('-c', `botDefaultUserId=${env.BOT_DEFAULT_USER_ID}`);
  }
  if (env.ENABLE_AGGREGATOR === 'true') {
    const value = required(env.AGGREGATOR_API_URL, 'Aggregator HTTPS API URL is required');
    let url; try { url = new URL(value); } catch { fail('Aggregator HTTPS API URL is invalid'); }
    check(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Aggregator HTTPS API URL is invalid');
    context.push('-c', 'enableAggregator=true', '-c', `aggregatorApiUrl=${value}`);
  }
  if (env.ENABLE_AGENTS === 'true') {
    context.push('-c', 'enableAgents=true', '-c', `assistantModel=${required(env.ASSISTANT_MODEL, 'Explicit assistant model is required')}`);
    if (env.ASSISTANT_TRACING_ENABLED === 'true') context.push('-c', 'assistantTracing=true');
  }
  if (env.ENABLE_CHATGPT_LINKING === 'true') {
    context.push('-c', 'enableChatGptLinking=true');
    for (const [variable, key] of [['CHATGPT_CLIENT_ID', 'chatGptClientId'], ['CHATGPT_REDIRECT_URI', 'chatGptRedirectUri'], ['CHATGPT_CLIENT_AUTH_METHOD', 'chatGptClientAuthMethod']]) context.push('-c', `${key}=${required(env[variable], 'Approved ChatGPT configuration is required')}`);
  }
  if (env.ENABLE_MCP === 'true') {
    context.push('-c', 'enableMcp=true');
    for (const [variable, key] of [['MCP_CERTIFICATE_ARN', 'mcpCertificateArn'], ['MCP_DOMAIN_NAME', 'mcpDomainName']]) context.push('-c', `${key}=${required(env[variable], 'MCP TLS configuration is required')}`);
    if (env.MCP_POINTUP_URL) context.push('-c', `mcpPointupUrl=${env.MCP_POINTUP_URL}`);
  }
  return context;
}
export function migrationManifest(root) {
  const entries = JSON.parse(readFileSync(resolve(root, 'packages/core/drizzle/meta/_journal.json'), 'utf8')).entries;
  check(Array.isArray(entries) && entries.length > 0, 'Migration journal is missing');
  let previous = -1;
  const migrations = entries.map(entry => {
    check(Number.isSafeInteger(entry.idx) && entry.idx === previous + 1 && Number.isSafeInteger(entry.when) && /^[0-9]{4}_[a-z0-9_]+$/.test(entry.tag), 'Migration journal is malformed');
    previous = entry.idx;
    return { idx: entry.idx, when: entry.when, tag: entry.tag, hash: hash(readFileSync(resolve(root, `packages/core/drizzle/${entry.tag}.sql`))) };
  });
  const manifest = { version: 1, files: [{ path: "meta/_journal.json", sha256: hash(readFileSync(resolve(root, "packages/core/drizzle/meta/_journal.json"))) }, ...migrations.map(migration => ({ path: `${migration.tag}.sql`, sha256: migration.hash }))] };
  return { manifest, sha256: hash(JSON.stringify(manifest)) };
}
export function candidateAssets(assembly, readJson, account, region) {
  const manifest = readJson(resolve(assembly, 'manifest.json'));
  const matches = [];
  for (const artifact of Object.values(manifest.artifacts ?? {})) {
    if (artifact.type !== 'cdk:asset-manifest') continue;
    const path = resolve(assembly, artifact.properties?.file ?? '');
    check(path.startsWith(resolve(assembly) + '/'), 'Asset manifest escapes assembly');
    for (const [id, asset] of Object.entries(readJson(path).dockerImages ?? {})) {
      check(asset.source && typeof asset.source.directory === 'string', 'Docker asset source is invalid');
      check(/^[a-f0-9]{64}$/.test(id), 'Worker asset hash is invalid');
      const destinations = Object.values(asset.destinations ?? {}).filter(value => value.region === region && value.assumeRoleArn?.includes(`::${account}:role/`));
      check(destinations.length === 1, 'Worker asset destination is ambiguous');
      const destination = destinations[0];
      check(/^[a-zA-Z0-9][a-zA-Z0-9/_-]*$/.test(destination.repositoryName) && destination.imageTag === id, 'Worker asset destination is invalid');
      matches.push({ manifestPath: path, id, dockerFile: asset.source.dockerFile ?? "Dockerfile", ...destination });
    }
  }
  check(matches.length > 0 && matches.filter(asset => asset.dockerFile === 'Dockerfile.worker').length === 1, 'Exactly one candidate worker asset is required');
  return matches;
}
function ownArn(value, service, account, region) {
  check(typeof value === 'string' && value.startsWith(`arn:aws:${service}:${region}:${account}:`), 'Resource account or region mismatch');
  return value;
}
export function migrationRegistration(definition, image, identity, expectedHash) {
  const { account, region } = identity;
  check(definition.requiresCompatibilities?.includes('FARGATE') && definition.networkMode === 'awsvpc' && definition.containerDefinitions?.length === 1, 'Unsupported migration task shape');
  check(/^TemplateApp[a-zA-Z0-9_-]{0,244}$/.test(definition.family ?? '') && definition.cpu === '256' && definition.memory === '512', 'Unsupported migration task sizing or family');
  for (const key of ['executionRoleArn', 'taskRoleArn']) check(typeof definition[key] === 'string' && definition[key].startsWith(`arn:aws:iam::${account}:role/TemplateApp-`), 'Migration roles must be existing account roles');
  const container = definition.containerDefinitions[0];
  check(container.name === 'Migrate' && container.essential !== false && container.command?.length === 1 && container.command[0] === 'migrate' && !container.entryPoint && !(container.mountPoints?.length) && !(container.portMappings?.length), 'Unsupported migration container');
  check(container.logConfiguration?.logDriver === 'awslogs' && container.logConfiguration.options?.['awslogs-region'] === region, 'Migration logging is invalid');
  const secrets = ['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'].map(name => {
    const values = (container.secrets ?? []).filter(secret => secret.name === name);
    check(values.length === 1, 'Migration DB secret fields are incomplete');
    ownArn(values[0].valueFrom, 'secretsmanager', account, region);
    return { ...values[0] };
  });
  const keys = { DB_HOST: 'host', DB_PORT: 'port', DB_USER: 'username', DB_PASSWORD: 'password', DB_NAME: 'dbname' };
  const secretArns = secrets.map(secret => {
    const suffix = `:${keys[secret.name]}::`;
    check(secret.valueFrom.endsWith(suffix), 'Migration DB secret selector is invalid');
    return secret.valueFrom.slice(0, -suffix.length);
  });
  check(new Set(secretArns).size === 1, 'Migration DB fields must use one real secret');
  check(/^[a-f0-9]{64}$/.test(expectedHash), 'Expected migration manifest is invalid');
  const result = { family: definition.family, executionRoleArn: definition.executionRoleArn, taskRoleArn: definition.taskRoleArn, networkMode: definition.networkMode,
    cpu: definition.cpu, memory: definition.memory, requiresCompatibilities: ['FARGATE'], tags: [{ key: 'pointup:stack', value: 'TemplateApp' }, { key: 'pointup:purpose', value: 'migration' }],
    containerDefinitions: [{ name: 'Migrate', essential: true, image, command: ['migrate'], logConfiguration: container.logConfiguration, secrets,
      environment: [{ name: 'NODE_ENV', value: 'production' }, { name: 'EXPECTED_MIGRATION_MANIFEST_SHA256', value: expectedHash }] }] };
  if (definition.runtimePlatform) {
    check(definition.runtimePlatform.cpuArchitecture === 'X86_64' && definition.runtimePlatform.operatingSystemFamily === 'LINUX', 'Unsupported migration architecture');
    result.runtimePlatform = definition.runtimePlatform;
  }
  return { registration: result, databaseSecretArn: secretArns[0] };
}
export function pinCandidateTemplate(assembly, assets, readJson, saveJson, inactive = false) {
  const assemblyManifestPath = resolve(assembly, 'manifest.json');
  const assemblyManifest = readJson(assemblyManifestPath);
  const artifacts = assemblyManifest.artifacts;
  const stack = artifacts?.TemplateApp;
  check(stack?.type === 'aws:cloudformation:stack', 'Candidate stack artifact is missing');
  const templatePath = resolve(assembly, stack.properties?.templateFile ?? '');
  check(templatePath.startsWith(resolve(assembly) + '/'), 'Stack template escapes assembly');
  const template = readJson(templatePath);
  const pinned = new Set();
  let services = 0;
  for (const resource of Object.values(template.Resources ?? {})) {
    if (resource.Type === 'AWS::ECS::TaskDefinition') for (const container of resource.Properties?.ContainerDefinitions ?? []) {
      const matches = assets.filter(asset => JSON.stringify(container.Image).includes(asset.id));
      check(matches.length === 1, 'Candidate task image does not match one published asset');
      container.Image = matches[0].image; pinned.add(matches[0].id);
    }
    if (resource.Type === 'AWS::ECS::Service') { services += 1; if (inactive) check(resource.Properties?.DesiredCount === 0, 'Inactive bootstrap contains active service'); }
    if (inactive && resource.Type === 'AWS::Events::Rule') check(resource.Properties?.State === 'DISABLED', 'Inactive bootstrap contains enabled schedule');
    if (inactive && resource.Type === 'AWS::ApplicationAutoScaling::ScalableTarget') check(resource.Properties?.MinCapacity === 0 && resource.Properties?.MaxCapacity === 0, 'Inactive bootstrap contains active scaling');
  }
  check(pinned.size === assets.length && services > 0, 'Candidate worker definitions or services are missing');
  saveJson(templatePath, template);
  // CDK prefers the template URL over local bytes. Retain its real file-publisher
  // role but give the pinned bytes a new immutable asset identity and S3 object key.
  const templateAssetHash = hash(JSON.stringify(template, null, 2));
  let templateAssets = 0;
  for (const artifact of Object.values(artifacts)) {
    if (artifact.type !== 'cdk:asset-manifest') continue;
    const assetManifestPath = resolve(assembly, artifact.properties.file);
    const assetManifest = readJson(assetManifestPath);
    for (const [oldId, file] of Object.entries(assetManifest.files ?? {})) {
      if (resolve(dirname(assetManifestPath), file.source?.path ?? '') !== templatePath) continue;
      check(/^[a-f0-9]{64}$/.test(oldId) && file.source.packaging === 'file', 'Template file asset is invalid');
      const destinations = Object.values(file.destinations ?? {});
      check(destinations.length === 1 && destinations[0].region === assets[0].region && destinations[0].assumeRoleArn?.startsWith(assets[0].assumeRoleArn.split(':role/')[0] + ':role/'), 'Template file publisher ownership is invalid');
      check(typeof destinations[0].objectKey === 'string' && destinations[0].objectKey.includes(oldId) && typeof stack.properties.stackTemplateAssetObjectUrl === 'string' && stack.properties.stackTemplateAssetObjectUrl.includes(oldId), 'Template file URL does not match the original asset');
      destinations[0].objectKey = destinations[0].objectKey.replaceAll(oldId, templateAssetHash);
      stack.properties.stackTemplateAssetObjectUrl = stack.properties.stackTemplateAssetObjectUrl.replaceAll(oldId, templateAssetHash);
      delete assetManifest.files[oldId]; assetManifest.files[templateAssetHash] = file;
      saveJson(assetManifestPath, assetManifest); templateAssets += 1;
    }
  }
  check(templateAssets === 1, 'Exactly one digest-pinned template file asset is required');
  saveJson(assemblyManifestPath, assemblyManifest);
  return { path: templatePath, sha256: hash(JSON.stringify(template)), resourceIds: Object.keys(template.Resources).sort() };
}
export function assertUpgradePreservesResources(deployed, candidate) {
  check(deployed && typeof deployed.Resources === 'object', 'Deployed stack template is unavailable');
  const critical = new Set(['AWS::RDS::DBInstance', 'AWS::EC2::VPC', 'AWS::EC2::Subnet', 'AWS::EC2::NatGateway', 'AWS::EC2::InternetGateway', 'AWS::EC2::RouteTable', 'AWS::EC2::Route', 'AWS::RDS::DBSubnetGroup', 'AWS::ECS::Cluster']);
  const canonical = value => JSON.stringify(value, (_, current) => current && typeof current === 'object' && !Array.isArray(current) ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b))) : current);
  for (const [id, resource] of Object.entries(deployed.Resources)) {
    const next = candidate.Resources?.[id];
    check(next && next.Type === resource.Type, 'Candidate removes or replaces an existing resource identity');
    if (critical.has(resource.Type)) check(canonical(resource.Properties ?? {}) === canonical(next.Properties ?? {}), 'Candidate changes protected database or network properties; separate reviewed infrastructure rollout is required');
    if (resource.Type === 'AWS::IAM::Role') for (const key of ['RoleName', 'Path', 'AssumeRolePolicyDocument']) check(canonical(resource.Properties?.[key]) === canonical(next.Properties?.[key]), 'Candidate changes an existing task role identity or trust');
  }
}
export function assertApprovedBackup(snapshot, database, identity, now = new Date()) {
  ownArn(snapshot?.DBSnapshotArn, 'rds', identity.account, identity.region);
  check(snapshot.Status === 'available' && snapshot.DBInstanceIdentifier === database.DBInstanceIdentifier && snapshot.DbiResourceId === database.DbiResourceId && snapshot.Encrypted === true, 'Approved backup does not match the live encrypted database');
  const createdAt = Date.parse(snapshot.SnapshotCreateTime);
  check(Number.isFinite(createdAt) && createdAt <= now.getTime() && now.getTime() - createdAt <= 24 * 60 * 60_000, 'Approved backup must be completed within the preceding 24 hours');
}
export async function rollout({ env, root, run, readJson = path => JSON.parse(readFileSync(path, 'utf8')), saveJson = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2)), makeDirectory = path => mkdirSync(path, { recursive: true }), manifest = migrationManifest, pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  if (env.VERIFY_ONLY === 'true') return { phase: 'verification-only' };
  const region = required(env.AWS_REGION, 'Explicit AWS region is required');
  check(/^[a-z]{2}-[a-z]+-[0-9]+$/.test(region), 'Invalid AWS region');
  const aws = async (service, operation, ...args) => JSON.parse((await run('aws', [service, operation, ...args, '--region', region, '--output', 'json'])).trim() || '{}');
  const account = (await aws('sts', 'get-caller-identity')).Account;
  check(/^[0-9]{12}$/.test(account), 'Invalid AWS account identity');
  const context = contextFromEnvironment(env);
  const stacks = await aws('cloudformation', 'list-stacks');
  check(Array.isArray(stacks.StackSummaries), 'Stack lookup is ambiguous');
  const live = stacks.StackSummaries.filter(stack => stack.StackName === 'TemplateApp' && stack.StackStatus !== 'DELETE_COMPLETE');
  check(live.length <= 1, 'Stack lookup is ambiguous');
  const firstCreate = live.length === 0;
  const identity = { account, region };
  const infra = resolve(root, 'infra');
  const cdk = resolve(infra, 'node_modules/.bin/cdk');
  const publisher = resolve(infra, 'node_modules/.bin/cdk-assets');
  const assembly = resolve(infra, 'cdk.out-release');
  const inactiveAssembly = resolve(infra, 'cdk.out-bootstrap');
  const expected = manifest(root);
  const receipt = { version: 1, commit: env.GITHUB_SHA, account, region, firstCreate, migrationManifestSha256: expected.sha256 };
  const progress = phase => saveJson(resolve(assembly, 'pointup-release.json'), { ...receipt, phase });
  makeDirectory(assembly);
  progress('preparing-candidate');
  saveJson(resolve(assembly, 'pointup-migrations.json'), expected.manifest);
  const cdkEnv = { ...env, CDK_DEFAULT_ACCOUNT: account, CDK_DEFAULT_REGION: region };
  await run(cdk, ['synth', 'TemplateApp', '--output', assembly, ...context], { cwd: infra, env: cdkEnv });
  progress('candidate-synthesized');
  saveJson(resolve(assembly, 'pointup-migrations.json'), expected.manifest);
  const assets = candidateAssets(assembly, readJson, account, region);
  for (const path of new Set(assets.map(asset => asset.manifestPath))) await run(publisher, ['publish', '--path', path], { cwd: infra, env: cdkEnv });
  const pinnedAssets = [];
  for (const asset of assets) {
    const images = await aws('ecr', 'describe-images', '--repository-name', asset.repositoryName, '--image-ids', `imageTag=${asset.imageTag}`);
    check(images.imageDetails?.length === 1 && /^sha256:[a-f0-9]{64}$/.test(images.imageDetails[0].imageDigest), 'Candidate image digest is missing');
    const digest = images.imageDetails[0].imageDigest;
    pinnedAssets.push({ ...asset, digest, image: `${account}.dkr.ecr.${region}.amazonaws.com/${asset.repositoryName}@${digest}` });
  }
  const candidate = pinnedAssets.find(asset => asset.dockerFile === 'Dockerfile.worker');
  const { digest, image } = candidate;
  const activeTemplate = pinCandidateTemplate(assembly, pinnedAssets, readJson, saveJson);
  for (const path of new Set(assets.map(asset => asset.manifestPath))) await run(publisher, ['publish', '--path', path], { cwd: infra, env: cdkEnv });
  const activeAssemblyPaths = [resolve(assembly, 'manifest.json'), ...new Set(assets.map(asset => asset.manifestPath))];
  const activeAssemblyHash = hash(JSON.stringify(activeAssemblyPaths.map(path => readJson(path))));
  if (!firstCreate) {
    const deployed = await aws('cloudformation', 'get-template', '--stack-name', 'TemplateApp', '--template-stage', 'Original');
    const body = typeof deployed.TemplateBody === 'string' ? JSON.parse(deployed.TemplateBody) : deployed.TemplateBody;
    assertUpgradePreservesResources(body, readJson(activeTemplate.path));
  }
  if (firstCreate) {
    // This lookup authorizes synthesis only; execution separately requires a CREATE stub.
    const checkStacks = await aws('cloudformation', 'list-stacks');
    check(Array.isArray(checkStacks.StackSummaries) && !checkStacks.StackSummaries.some(stack => stack.StackName === 'TemplateApp' && stack.StackStatus !== 'DELETE_COMPLETE'), 'First creation requires confirmed stack absence');
    await run(cdk, ['synth', 'TemplateApp', '--output', inactiveAssembly, ...context, '-c', 'bootstrapInactive=true', '-c', 'bootstrapStackConfirmedAbsent=true'], { cwd: infra, env: cdkEnv });
    const inactiveAssets = candidateAssets(inactiveAssembly, readJson, account, region);
    check(JSON.stringify(inactiveAssets.map(asset => asset.id).sort()) === JSON.stringify(pinnedAssets.map(asset => asset.id).sort()), 'Bootstrap and activation assets differ');
    const inactiveTemplate = pinCandidateTemplate(inactiveAssembly, pinnedAssets, readJson, saveJson, true);
    for (const path of new Set(inactiveAssets.map(asset => asset.manifestPath))) await run(publisher, ['publish', '--path', path], { cwd: infra, env: cdkEnv });
    check(JSON.stringify(inactiveTemplate.resourceIds) === JSON.stringify(activeTemplate.resourceIds), 'Bootstrap construct identities differ from activation');
    const changeSetName = `pointup-bootstrap-${randomUUID()}`;
    // Preparing cannot update hosts even if another operator creates the stack during synthesis.
    await run(cdk, ['deploy', 'TemplateApp', '--app', inactiveAssembly, '--require-approval', 'never', '--method', 'prepare-change-set', '--change-set-name', changeSetName], { cwd: infra, env: cdkEnv });
    const changeSet = await aws('cloudformation', 'describe-change-set', '--stack-name', 'TemplateApp', '--change-set-name', changeSetName);
    const changeSetArn = ownArn(changeSet.ChangeSetId, 'cloudformation', account, region);
    const stackId = ownArn(changeSet.StackId, 'cloudformation', account, region);
    check(changeSetArn.includes(`:changeSet/${changeSetName}/`) && stackId.includes(':stack/TemplateApp/') && changeSet.Status === 'CREATE_COMPLETE' && changeSet.ExecutionStatus === 'AVAILABLE', 'Bootstrap change set is unavailable or has unexpected identity');
    receipt.bootstrapChangeSetArn = changeSetArn; receipt.bootstrapStackId = stackId;
    progress('bootstrap-prepared');
    const stub = await aws('cloudformation', 'describe-stacks', '--stack-name', stackId);
    check(stub.Stacks?.length === 1 && stub.Stacks[0].StackId === stackId && stub.Stacks[0].StackStatus === 'REVIEW_IN_PROGRESS', 'Bootstrap requires a new CREATE-only stack stub');
    const changes = changeSet.Changes ?? [];
    check(changes.length === inactiveTemplate.resourceIds.length && changes.every(change => change.Type === 'Resource' && change.ResourceChange?.Action === 'Add') && JSON.stringify(changes.map(change => change.ResourceChange.LogicalResourceId).sort()) === JSON.stringify(inactiveTemplate.resourceIds), 'Bootstrap change set must only create the exact inactive resources');
    await aws('cloudformation', 'execute-change-set', '--change-set-name', changeSetArn, '--stack-name', stackId);
    progress('bootstrap-creating');
    await run('aws', ['cloudformation', 'wait', 'stack-create-complete', '--stack-name', stackId, '--region', region], { timeout: 20 * 60_000 });
    const created = await aws('cloudformation', 'describe-stacks', '--stack-name', stackId);
    check(created.Stacks?.length === 1 && created.Stacks[0].StackId === stackId && created.Stacks[0].StackStatus === 'CREATE_COMPLETE', 'Bootstrap creation did not complete for the prepared stack');
    progress('bootstrap-created');
  }
  const description = await aws('cloudformation', 'describe-stacks', '--stack-name', 'TemplateApp');
  check(description.Stacks?.length === 1 && ['CREATE_COMPLETE', 'UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'].includes(description.Stacks[0].StackStatus), 'Production stack is not stable');
  const outputs = Object.fromEntries((description.Stacks[0].Outputs ?? []).map(output => [output.OutputKey, output.OutputValue]));
  if (firstCreate) check(outputs.DeploymentPhase === 'inactive-bootstrap', 'Bootstrap did not produce inactive hosts');
  const cluster = ownArn(outputs.ClusterArn, 'ecs', account, region);
  const definitionArn = ownArn(outputs.MigrationTaskDefinitionArn, 'ecs', account, region);
  const subnetIds = required(outputs.MigrationSubnetIds, 'Migration subnets are missing').split(',').map(value => value.trim());
  check(subnetIds.length > 0 && subnetIds.every(value => /^subnet-[a-f0-9]+$/.test(value)) && new Set(subnetIds).size === subnetIds.length, 'Migration subnet IDs are invalid');
  check(/^sg-[a-f0-9]+$/.test(outputs.MigrationSecurityGroupId ?? ''), 'Migration security group is invalid');
  const network = await aws('ec2', 'describe-subnets', '--subnet-ids', ...subnetIds);
  check(network.Subnets?.length === subnetIds.length && network.Subnets.every(subnet => subnetIds.includes(subnet.SubnetId) && subnet.State === 'available' && subnet.MapPublicIpOnLaunch === false && subnet.OwnerId === account), 'Migration private subnets are invalid');
  const groups = await aws('ec2', 'describe-security-groups', '--group-ids', outputs.MigrationSecurityGroupId);
  check(groups.SecurityGroups?.length === 1 && groups.SecurityGroups[0].OwnerId === account && network.Subnets.every(subnet => subnet.VpcId === groups.SecurityGroups[0].VpcId), 'Migration network ownership mismatch');
  const clusters = await aws('ecs', 'describe-clusters', '--clusters', cluster);
  check(!clusters.failures?.length && clusters.clusters?.length === 1 && clusters.clusters[0].clusterArn === cluster && clusters.clusters[0].status === 'ACTIVE', 'Migration cluster is invalid');
  const definition = (await aws('ecs', 'describe-task-definition', '--task-definition', definitionArn)).taskDefinition;
  check(definition?.taskDefinitionArn === definitionArn, 'Migration task definition is missing');
  const prepared = migrationRegistration(definition, image, identity, expected.sha256);
  check(outputs.DatabaseSecretArn === prepared.databaseSecretArn, 'Migration secret is not the stack database secret');
  const resources = await aws('cloudformation', 'list-stack-resources', '--stack-name', 'TemplateApp');
  const databases = (resources.StackResourceSummaries ?? []).filter(resource => resource.ResourceType === 'AWS::RDS::DBInstance');
  check(databases.length === 1 && /^[a-z][a-z0-9-]{0,62}$/.test(databases[0].PhysicalResourceId ?? ''), 'Stack database identity is ambiguous');
  const databaseResponse = await aws('rds', 'describe-db-instances', '--db-instance-identifier', databases[0].PhysicalResourceId);
  const database = databaseResponse.DBInstances?.[0];
  check(databaseResponse.DBInstances?.length === 1 && database.DBInstanceIdentifier === databases[0].PhysicalResourceId && database.DBInstanceStatus === 'available' && database.StorageEncrypted === true && database.DBSubnetGroup?.VpcId === groups.SecurityGroups[0].VpcId, 'Stack database is unavailable or belongs to another network');
  ownArn(database.DBInstanceArn, 'rds', account, region);
  let approvedSnapshotArn;
  if (!firstCreate) {
    approvedSnapshotArn = ownArn(required(env.APPROVED_DATABASE_SNAPSHOT_ARN, 'An operator-approved completed database snapshot is required before migration'), 'rds', account, region);
    check(approvedSnapshotArn.includes(':snapshot:'), 'Approved snapshot ARN is invalid');
    const snapshots = await aws('rds', 'describe-db-snapshots', '--db-snapshot-identifier', approvedSnapshotArn);
    check(snapshots.DBSnapshots?.length === 1 && snapshots.DBSnapshots[0].DBSnapshotArn === approvedSnapshotArn, 'Approved database snapshot is missing');
    assertApprovedBackup(snapshots.DBSnapshots[0], database, identity);
  }
  receipt.approvedSnapshotArn = approvedSnapshotArn;
  const secret = await aws('secretsmanager', 'describe-secret', '--secret-id', prepared.databaseSecretArn);
  check(secret.ARN === prepared.databaseSecretArn && !secret.DeletedDate, 'Migration database secret is unavailable');
  const registrationPath = resolve(assembly, 'migration-registration.json');
  saveJson(registrationPath, prepared.registration);
  const registered = await aws('ecs', 'register-task-definition', '--cli-input-json', `file://${registrationPath}`);
  const taskDefinition = ownArn(registered.taskDefinition?.taskDefinitionArn, 'ecs', account, region);
  receipt.migrationTaskDefinitionArn = taskDefinition;
  progress('migration-registered');
  const networkConfiguration = JSON.stringify({ awsvpcConfiguration: { subnets: subnetIds, securityGroups: [outputs.MigrationSecurityGroupId], assignPublicIp: 'DISABLED' } });
  const started = await aws('ecs', 'run-task', '--cluster', cluster, '--task-definition', taskDefinition, '--launch-type', 'FARGATE', '--network-configuration', networkConfiguration);
  check(!started.failures?.length && started.tasks?.length === 1, 'Migration task launch failed');
  const taskArn = ownArn(started.tasks[0].taskArn, 'ecs', account, region);
  receipt.migrationTaskArn = taskArn;
  const logging = prepared.registration.containerDefinitions[0].logConfiguration.options;
  const group = required(logging['awslogs-group'], 'Migration log group is missing');
  const prefix = required(logging['awslogs-stream-prefix'], 'Migration log stream prefix is missing');
  const stream = `${prefix}/Migrate/${taskArn.split('/').at(-1)}`;
  receipt.migrationLogGroup = group; receipt.migrationLogStream = stream;
  progress('migration-running');
  try {
    await run('aws', ['ecs', 'wait', 'tasks-stopped', '--cluster', cluster, '--tasks', taskArn, '--region', region], { timeout: 20 * 60_000 });
  } catch {
    try { await aws('ecs', 'stop-task', '--cluster', cluster, '--task', taskArn, '--reason', 'Migration wait failed; promotion blocked'); } catch { /* Promotion remains blocked even if cleanup cannot be confirmed. */ }
    fail('Migration task wait failed; inspect the owned task before retrying');
  }
  const completed = await aws('ecs', 'describe-tasks', '--cluster', cluster, '--tasks', taskArn);
  const task = completed.tasks?.[0];
  check(!completed.failures?.length && completed.tasks?.length === 1 && task?.taskArn === taskArn && task.taskDefinitionArn === taskDefinition && task.lastStatus === 'STOPPED', 'Migration completion is missing');
  const container = task.containers?.find(value => value.name === 'Migrate');
  check(task.containers?.length === 1 && container?.exitCode === 0 && container.imageDigest === digest, 'Candidate migration or journal verification failed');
  let attested = false;
  for (let attempt = 0; attempt < 12 && !attested; attempt += 1) {
    const log = await aws('logs', 'get-log-events', '--log-group-name', group, '--log-stream-name', stream, '--start-from-head');
    attested = (log.events ?? []).some(event => {
      let proof;
      try { proof = JSON.parse(event.message); } catch { return false; }
      return proof.component === 'pointup_migrations' && proof.event === 'journal_verified' && proof.schemaVerified === true && proof.manifestSha256 === expected.sha256 && proof.migrationCount === expected.manifest.files.length - 1;
    });
    if (!attested && attempt < 11) await pause(1000);
  }
  check(attested, 'Migration journal attestation is missing or mismatched');
  // Candidate migrate is required to verify EXPECTED_MIGRATION_MANIFEST_SHA256
  // and the complete managed journal under its lock before returning zero.
  Object.assign(receipt, { templateSha256: activeTemplate.sha256, images: pinnedAssets.map(asset => ({ assetHash: asset.id, image: asset.image })), workerAssetHash: candidate.id, workerImage: image });
  progress('journal-verified');
  check(hash(JSON.stringify(activeAssemblyPaths.map(path => readJson(path)))) === activeAssemblyHash && hash(JSON.stringify(readJson(activeTemplate.path))) === activeTemplate.sha256, 'Candidate assembly changed after migration');
  if (firstCreate || (outputs.DeploymentPhase === 'inactive-bootstrap' && env.BOOTSTRAP_READY !== 'true')) {
    progress('inactive-awaiting-secret-readiness');
    return { phase: 'inactive-awaiting-secret-readiness', firstCreate, migrationTaskArn: taskArn };
  }
  progress('activation-starting');
  await run(cdk, ['deploy', 'TemplateApp', '--app', assembly, '--require-approval', 'never', '--outputs-file', resolve(infra, 'cdk-outputs.json')], { cwd: infra, env: cdkEnv });
  progress('activated');
  return { phase: 'activated', firstCreate, migrationTaskArn: taskArn };
}
export function recordRolloutFailure(path, readJson = file => JSON.parse(readFileSync(file, 'utf8')), saveJson = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2))) {
  try {
    const receipt = readJson(path);
    saveJson(path, { ...receipt, lastRecordedPhase: receipt.phase, phase: 'failed', failureCode: 'DEPLOYMENT_ABORTED' });
  } catch { /* Keep the original failure if the receipt cannot be read or persisted. */ }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const run = (command, args, options = {}) => {
    try { return execFileSync(command, args, { cwd: root, env: process.env, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 8 * 1024 * 1024, ...options }); }
    catch { throw new Error('Deployment command failed; inspect the authorized task or deployment status'); }
  };
  try { const result = await rollout({ env: process.env, root, run }); console.info(JSON.stringify(result)); }
  catch (error) {
    recordRolloutFailure(resolve(root, 'infra/cdk.out-release/pointup-release.json'));
    console.error(error.message); process.exitCode = 1;
  }
}
