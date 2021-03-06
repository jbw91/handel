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
const sqs = require('../../../dist/services/sqs');
const sqsCalls = require('../../../dist/aws/sqs-calls');
const ServiceContext = require('../../../dist/datatypes/service-context');
const DeployContext = require('../../../dist/datatypes/deploy-context');
const ConsumeEventsContext = require('../../../dist/datatypes/consume-events-context');
const PreDeployContext = require('../../../dist/datatypes/pre-deploy-context');
const deployPhaseCommon = require('../../../dist/common/deploy-phase-common');
const deletePhasesCommon = require('../../../dist/common/delete-phases-common');
const UnDeployContext = require('../../../dist/datatypes/un-deploy-context');
const sinon = require('sinon');
const expect = require('chai').expect;

describe('sqs deployer', function () {
    let sandbox;

    beforeEach(function () {
        sandbox = sinon.sandbox.create();
    });

    afterEach(function () {
        sandbox.restore();
    });

    describe('check', function () {
        it('shouldnt validate anything yet', function () {
            let serviceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "FakeType", {}, {});
            let errors = sqs.check(serviceContext);
            expect(errors).to.deep.equal([]);
        });
    });

    describe('deploy', function () {
        let appName = "FakeApp";
        let envName = "FakeEnv";
        let serviceName = "FakeService"; // FIXME: deadLetter versions?
        let serviceType = "sqs";
        let queueName = "FakeQueue";
        let queueArn = "FakeArn";
        let queueUrl = "FakeUrl";
        let deadLetterQueueName = "FakeDeadLetterQueue";
        let deadLetterQueueArn = "FakeDeadLetterArn";
        let deadLetterQueueUrl = "FakeDeadLetterUrl";

        let ownServiceContext = new ServiceContext(appName, envName, serviceName, serviceType, {
            type: 'sqs',
            queue_type: 'fifo',
            content_based_deduplication: true,
            delay_seconds: 2,
            max_message_size: 262140,
            message_retention_period: 345601,
            visibility_timeout: 40,
            dead_letter_queue: {
              max_receive_count: 5,
              queue_type: 'fifo',
              content_based_deduplication: true,
              delay_seconds: 2,
              max_message_size: 262140,
              message_retention_period: 345601,
              visibility_timeout: 40
            }
        }, {});
        let ownPreDeployContext = new PreDeployContext(ownServiceContext);

        it('should deploy the queue', function () {
            let deployStackStub = sandbox.stub(deployPhaseCommon, 'deployCloudFormationStack').returns(Promise.resolve({
                Outputs: [
                    {
                        OutputKey: 'QueueName',
                        OutputValue: queueName
                    },
                    {
                        OutputKey: 'QueueArn',
                        OutputValue: queueArn
                    },
                    {
                        OutputKey: 'QueueUrl',
                        OutputValue: queueUrl
                    },
                    {
                        OutputKey: 'DeadLetterQueueName',
                        OutputValue: deadLetterQueueName
                    },
                    {
                        OutputKey: 'DeadLetterQueueArn',
                        OutputValue: deadLetterQueueArn
                    },
                    {
                        OutputKey: 'DeadLetterQueueUrl',
                        OutputValue: deadLetterQueueUrl
                    }
                ]
            }));

            return sqs.deploy(ownServiceContext, ownPreDeployContext, [])
                .then(deployContext => {
                    expect(deployStackStub.calledOnce).to.be.true;

                    expect(deployContext).to.be.instanceof(DeployContext);

                    let envPrefix = serviceName.toUpperCase();

                    //Should have exported 3 env vars
                    expect(deployContext.environmentVariables).to.have.property(`${envPrefix}_QUEUE_NAME`, queueName);
                    expect(deployContext.environmentVariables).to.have.property(`${envPrefix}_QUEUE_URL`, queueUrl);
                    expect(deployContext.environmentVariables).to.have.property(`${envPrefix}_QUEUE_ARN`, queueArn);

                    expect(deployContext.environmentVariables).to.have.property(`${envPrefix}_DEAD_LETTER_QUEUE_NAME`,deadLetterQueueName);
                    expect(deployContext.environmentVariables).to.have.property(`${envPrefix}_DEAD_LETTER_QUEUE_URL`, deadLetterQueueUrl);
                    expect(deployContext.environmentVariables).to.have.property(`${envPrefix}_DEAD_LETTER_QUEUE_ARN`, deadLetterQueueArn);

                    //Should have exported 1 policy
                    expect(deployContext.policies.length).to.equal(1); //Should have exported one policy
                    expect(deployContext.policies[0].Resource[0]).to.equal(queueArn);
                    expect(deployContext.policies[0].Resource[1]).to.equal(deadLetterQueueArn);
                });
        });
    });

    describe('consumeEvents', function () {
        it('should throw an error because SQS cant consume event services', function () {
            let appName = "FakeApp";
            let envName = "FakeEnv";
            let consumerServiceContext = new ServiceContext(appName, envName, "ConsumerService", "sqs", {}, {});
            let consumerDeployContext = new DeployContext(consumerServiceContext);
            consumerDeployContext.eventOutputs.queueUrl = "FakeQueueUrl";
            consumerDeployContext.eventOutputs.queueArn = "FakeQueueArn";

            let producerServiceContext = new ServiceContext(appName, envName, "ProducerService", "sns", {}, {});
            let producerDeployContext = new DeployContext(producerServiceContext);
            producerDeployContext.eventOutputs.topicArn = "FakeTopicArn";

            let addSqsPermissionStub = sandbox.stub(sqsCalls, 'addSqsPermissionIfNotExists').returns(Promise.resolve({}));

            return sqs.consumeEvents(consumerServiceContext, consumerDeployContext, producerServiceContext, producerDeployContext)
                .then(consumeEventsContext => {
                    expect(addSqsPermissionStub.calledOnce).to.be.true;
                    expect(consumeEventsContext).to.be.instanceOf(ConsumeEventsContext);
                });
        });
    });

    describe('unDeploy', function () {
        it('should undeploy the stack', function () {
            let serviceContext = new ServiceContext("FakeApp", "FakeEnv", "FakeService", "sqs", {}, {});
            let unDeployStackStub = sandbox.stub(deletePhasesCommon, 'unDeployService').returns(Promise.resolve(new UnDeployContext(serviceContext)));

            return sqs.unDeploy(serviceContext)
                .then(unDeployContext => {
                    expect(unDeployContext).to.be.instanceof(UnDeployContext);
                    expect(unDeployStackStub.calledOnce).to.be.ture;
                });
        });
    });
});
