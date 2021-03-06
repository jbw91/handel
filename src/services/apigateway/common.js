/*
 * Copyright 2017 Brigham Young University
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
const cloudformationCalls = require('../../aws/cloudformation-calls');
const deployPhaseCommon = require('../../common/deploy-phase-common');
const util = require('../../common/util');
const _ = require('lodash');


exports.getEnvVarsForService = function(ownEnvironmentVariables, ownServiceContext, dependenciesDeployContexts) {
    let returnEnvVars = {};

    if(ownEnvironmentVariables) {
        returnEnvVars = _.assign(returnEnvVars, ownEnvironmentVariables);
    }

    let dependenciesEnvVars = deployPhaseCommon.getEnvVarsFromDependencyDeployContexts(dependenciesDeployContexts);
    returnEnvVars = _.assign(returnEnvVars, dependenciesEnvVars);
    let handelInjectedEnvVars = deployPhaseCommon.getEnvVarsFromServiceContext(ownServiceContext);
    returnEnvVars = _.assign(returnEnvVars, handelInjectedEnvVars);

    return returnEnvVars;
}

exports.getSecurityGroups = function (ownPreDeployContext) {
    let securityGroups = [];
    if (ownPreDeployContext.securityGroups) {
        ownPreDeployContext.securityGroups.forEach((secGroup) => {
            securityGroups.push(secGroup.GroupId)
        })
    }
    return securityGroups;
}

exports.getRestApiUrl = function (cfStack, serviceContext) {
    let restApiId = cloudformationCalls.getOutput("RestApiId", cfStack);
    let restApiDomain = `${restApiId}.execute-api.${serviceContext.accountConfig.region}.amazonaws.com`;
    let stageName = serviceContext.environmentName; //Env name is the stage name
    let restApiUrl = `https://${restApiDomain}/${stageName}/`;
    return restApiUrl;
}

exports.getPolicyStatementsForLambdaRole = function (serviceContext, dependenciesDeployContexts) {
    let ownPolicyStatements;
    if (serviceContext.params.vpc) {
        ownPolicyStatements = JSON.parse(util.readFileSync(`${__dirname}/lambda-role-statements-vpc.json`));
    } else {
        ownPolicyStatements = JSON.parse(util.readFileSync(`${__dirname}/lambda-role-statements.json`));
    }
    ownPolicyStatements = ownPolicyStatements.concat(deployPhaseCommon.getAppSecretsAccessPolicyStatements(serviceContext));

    return deployPhaseCommon.getAllPolicyStatementsForServiceRole(ownPolicyStatements, dependenciesDeployContexts);
}