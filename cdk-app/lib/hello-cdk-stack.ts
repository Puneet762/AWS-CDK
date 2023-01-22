import { Stack, StackProps, aws_lambda, aws_apigateway , CfnOutput} from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

import { Construct } from 'constructs';
import * as cdk from '@aws-cdk/core'
import { Lambda } from 'aws-cdk-lib/aws-ses-actions';
import * as path from 'path';

// import * as sqs from 'aws-cdk-lib/aws-sqs';

export class HelloCdkStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // const hello= new aws_lambda.Function(this, 'HelloHandler', {
    //   runtime: aws_lambda.Runtime.NODEJS_14_X,
    //   code: aws_lambda.Code.fromAsset('lambda'),
    //   handler: 'hello.handler'
    // })

    const auroraLambda= new aws_lambda.Function(this, 'auroraHandler', {
      runtime: aws_lambda.Runtime.NODEJS_16_X,
      // entry: path.join(__dirname),
      code: aws_lambda.Code.fromAsset(path.join(__dirname, '../api/lambda/amazon-aurora')),
      handler: 'index.handler',
      
    })

    const redisLambda= new aws_lambda.Function(this, 'redisHandler', {
      runtime: aws_lambda.Runtime.NODEJS_16_X,
      code: aws_lambda.Code.fromAsset(path.join(__dirname, '../api/lambda/redis-cache')),
      handler: 'index.handler',
      
    })
    
    //api-gateway for amazon-aurora database
    const auroraLambdaGateway= new aws_apigateway.LambdaRestApi(this, 'EndpointDatabase', {
      handler: auroraLambda
    });

    //api-gateway for redis cache
    const redisLambdaGateway= new aws_apigateway.LambdaRestApi(this, 'EndpointRedis', {
      handler: redisLambda
    });

    //create user data script
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'sudo su',
      'yum install -y httpd',
      'systemctl start httpd',
      'systemctl enable httpd',
      'echo "<h1>Hello World from $(hostname -f)</h1>" > /var/www/html/index.html',
    );

    const vpc = new ec2.Vpc(this, 'vpc', {natGateways: 1});

    const alb = new elbv2.ApplicationLoadBalancer(this, 'alb', {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener('Listener', {
      port: 80,
      open: true,
    });

    //create auto scaling group
    const asg = new autoscaling.AutoScalingGroup(this, 'asg', {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE2,
        ec2.InstanceSize.MICRO,
      ),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      userData,
      minCapacity: 2,
      maxCapacity: 3,
    });

    // 👇 add target to the ALB listener
    listener.addTargets('default-target', {
      port: 80,
      targets: [asg],
      healthCheck: {
        path: '/',
        unhealthyThresholdCount: 2,
        healthyThresholdCount: 5
      },
    });

    // 👇 add an action to the ALB listener
    listener.addAction('/static', {
      priority: 5,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/static'])],
      action: elbv2.ListenerAction.fixedResponse(200, {
        contentType: 'text/html',
        messageBody: '<h1>Static ALB Response</h1>',
      }),
    });

    // 👇 add scaling policy for the Auto Scaling Group
    asg.scaleOnRequestCount('requests-per-minute', {
      targetRequestsPerMinute: 60,
    });

    // 👇 add scaling policy for the Auto Scaling Group
    asg.scaleOnCpuUtilization('cpu-util-scaling', {
      targetUtilizationPercent: 75,
    });

    // 👇 add the ALB DNS as an Output
    new CfnOutput(this, 'albDNS', {
      value: alb.loadBalancerDnsName,
    });
  }
}
