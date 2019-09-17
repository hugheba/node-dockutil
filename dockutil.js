#!/usr/bin/env node

require('dotenv').config();
const fs = require('fs');
const tar = require('tar-fs');
const {promisify}  = require('util');
const program = require('commander');
const getRepoInfo = require('git-repo-info');
const Docker = require('dockerode-promise');


const cwd = process.cwd();
const package = require(`${cwd}/package.json`);
const repoInfo = getRepoInfo(cwd);
const stat = promisify(fs.stat);

const docker = new Docker();

program
    .version('1.0.0')
    .option('-t', '--tag', 'Tag image')
    .option('-x', '--context', 'Docker build context')
    .parse(process.argv);

const auth = {
    username: process.env.DOCKER_USERNAME,
    email: process.env.DOCKER_EMAIL,
    password: process.env.DOCKER_PASSWORD,
    registry: process.env.DOCKER_PRIVATE_REGISTRY
};
const buildId = (repoInfo)?`-${repoInfo.abbreviatedSha}`:'';
const tag = program.tag || package.version;
const imageName = `${auth.registry}/${package.name}:${tag}${buildId}`;
const buildContext = program.context || cwd;
const namespace = process.env.K8S_NAMESPACE;
const deployment = process.env.K8S_DEPLOYMENT;
const service = process.env.K8S_SERVICE;


const dockerBuild = async () => {
    try {
        docker.buildImage(tar.pack(buildContext), {t: imageName}, (buildErr, buildOutput) => {
            buildOutput.pipe(process.stdout);
            buildOutput.on('end', () => {
                console.log(`Successfully built image ${imageName}`);
                const image = docker.getImage(imageName);
                image.push({
                    'authconfig': auth,
                    registry: `https://${auth.registry}`
                }, (pushErr, pushOutput) => {
                    pushOutput.pipe(process.stdout);
                    if (pushErr) console.error(`Error pushing image: ${pushErr.message}`);
                    pushOutput.on('end', () => {
                        console.log(`Successfully pushed image ${imageName}`);
                        return;
                    });
                });
            });
        });
    } catch (e) {
        console.error(`Unable to build image; ${e.message}`)
    }
}

const kubeDeploy = async () => {
    try {
        const config = require('kubernetes-client').config;
        const Client = require('kubernetes-client').Client;
        const client = new Client({
            config: config.fromKubeconfig()
        });
        await client.loadSpec();
        const ns = await client.apis.apps.v1.namespaces(namespace).get();
        console.log(ns);
    } catch (e) {
        console.error(`Unable to deploy to kubernetes; ${e.message}`)
    }
}

const main = async () => {
    await dockerBuild();
    //if (true) await kubeDeploy();
}

main();