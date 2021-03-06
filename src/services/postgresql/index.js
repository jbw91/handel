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
const winston = require('winston');
const handlebarsUtils = require('../../common/handlebars-utils');
const cloudFormationCalls = require('../../aws/cloudformation-calls');
const deployPhaseCommon = require('../../common/deploy-phase-common');
const preDeployPhaseCommon = require('../../common/pre-deploy-phase-common');
const bindPhaseCommon = require('../../common/bind-phase-common');
const deletePhasesCommon = require('../../common/delete-phases-common');
const rdsDeployersCommon = require('../../common/rds-deployers-common');

const SERVICE_NAME = "PostgreSQL";
const POSTGRES_PORT = 5432;
const POSTGRES_PROTOCOL = 'tcp';

function getParameterGroupFamily(postgresVersion) {
    if (postgresVersion.startsWith('9.3')) {
        return 'postgres9.3';
    }
    else if (postgresVersion.startsWith('9.4')) {
        return 'postgres9.4';
    }
    else if (postgresVersion.startsWith('9.5')) {
        return 'postgres9.5';
    }
    else {
        return 'postgres9.6';
    }
}

function getCompiledPostgresTemplate(stackName, ownServiceContext, ownPreDeployContext) {
    let serviceParams = ownServiceContext.params;
    let accountConfig = ownServiceContext.accountConfig;

    let postgresVersion = serviceParams.postgres_version;

    let handlebarsParams = {
        description: serviceParams.description || 'Parameter group for ' + stackName,
        storageGB: serviceParams.storage_gb || 5,
        instanceType: serviceParams.instance_type || 'db.t2.micro',
        stackName,
        databaseName: serviceParams.database_name,
        dbSubnetGroup: accountConfig.rds_subnet_group,
        postgresVersion,
        dbPort: POSTGRES_PORT,
        storageType: serviceParams.storage_type || 'standard',
        dbSecurityGroupId: ownPreDeployContext['securityGroups'][0].GroupId,
        parameterGroupFamily: getParameterGroupFamily(postgresVersion),
        tags: deployPhaseCommon.getTags(ownServiceContext)
    };

    //Add parameters to parameter group if specified
    if (serviceParams.db_parameters) {
        handlebarsParams.parameterGroupParams = serviceParams.db_parameters;
    }

    //Set multiAZ if user-specified
    if (serviceParams.multi_az) {
        handlebarsParams.multi_az = true;
    }

    return handlebarsUtils.compileTemplate(`${__dirname}/postgresql-template.yml`, handlebarsParams)
}


/**
 * Service Deployer Contract Methods
 * See https://github.com/byu-oit-appdev/handel/wiki/Creating-a-New-Service-Deployer#service-deployer-contract
 *   for contract method documentation
 */

exports.check = function (serviceContext, dependenciesServiceContexts) {
    let errors = [];
    let serviceParams = serviceContext.params;

    if (!serviceParams.database_name) {
        errors.push(`${SERVICE_NAME} - The 'database_name' parameter is required`);
    }
    if (!serviceParams.postgres_version) {
        errors.push(`${SERVICE_NAME} - The 'postgres_version' parameter is required`);
    }

    return errors;
}

exports.preDeploy = function (serviceContext) {
    return preDeployPhaseCommon.preDeployCreateSecurityGroup(serviceContext, POSTGRES_PORT, SERVICE_NAME);
}

exports.bind = function (ownServiceContext, ownPreDeployContext, dependentOfServiceContext, dependentOfPreDeployContext) {
    return bindPhaseCommon.bindDependentSecurityGroupToSelf(ownServiceContext, ownPreDeployContext, dependentOfServiceContext, dependentOfPreDeployContext, POSTGRES_PROTOCOL, POSTGRES_PORT, SERVICE_NAME);
}

exports.deploy = function (ownServiceContext, ownPreDeployContext, dependenciesDeployContexts) {
    let stackName = deployPhaseCommon.getResourceName(ownServiceContext);
    winston.info(`${SERVICE_NAME} - Deploying database '${stackName}'`);

    return cloudFormationCalls.getStack(stackName)
        .then(stack => {
            if (!stack) {
                let dbUsername = rdsDeployersCommon.getNewDbUsername();
                let dbPassword = rdsDeployersCommon.getNewDbPassword();
                return getCompiledPostgresTemplate(stackName, ownServiceContext, ownPreDeployContext)
                    .then(compiledTemplate => {
                        let cfParameters = cloudFormationCalls.getCfStyleStackParameters({
                            DBUsername: dbUsername,
                            DBPassword: dbPassword
                        });
                        let stackTags = deployPhaseCommon.getTags(ownServiceContext);
                        winston.debug(`${SERVICE_NAME} - Creating CloudFormation stack '${stackName}'`);
                        return cloudFormationCalls.createStack(stackName, compiledTemplate, cfParameters, stackTags)
                            .then(deployedStack => {
                                winston.debug(`${SERVICE_NAME} - Finished creating CloudFormation stack '${stackName}'`);
                                return rdsDeployersCommon.addDbCredentialToParameterStore(ownServiceContext, dbUsername, dbPassword, deployedStack);
                            });
                    });
            }
            else {
                winston.info(`${SERVICE_NAME} - Updates are not supported for this service.`);
                return stack;
            }
        })
        .then(deployedStack => {
            winston.info(`${SERVICE_NAME} - Finished deploying database '${stackName}'`)
            return rdsDeployersCommon.getDeployContext(ownServiceContext, deployedStack);
        });
}

exports.unPreDeploy = function (ownServiceContext) {
    return deletePhasesCommon.unPreDeploySecurityGroup(ownServiceContext, SERVICE_NAME);
}

exports.unBind = function (ownServiceContext) {
    return deletePhasesCommon.unBindSecurityGroups(ownServiceContext, SERVICE_NAME);
}

exports.unDeploy = function (ownServiceContext) {
    return deletePhasesCommon.unDeployService(ownServiceContext, SERVICE_NAME)
        .then(unDeployContext => {
            return rdsDeployersCommon.deleteParametersFromParameterStore(ownServiceContext, unDeployContext);
        });
}

exports.producedEventsSupportedServices = [];

exports.producedDeployOutputTypes = [
    'environmentVariables',
    'securityGroups'
];

exports.consumedDeployOutputTypes = [];
