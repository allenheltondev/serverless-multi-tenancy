const jwt = require('jsonwebtoken');
const { DynamoDBClient, GetItemCommand } = require('@aws-sdk/client-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const ddb = new DynamoDBClient();
const secrets = new SecretsManagerClient();
var signature;

exports.SIGNATURE_NOT_CONFIGURED = 'Unable to validate auth token because a signature is not configured';
exports.NOT_BEARER_TOKEN = 'The provided auth token is not a bearer token';

exports.handler = async (event, context) => {
  try {
    const authToken = event.headers?.Authorization ?? event.headers?.authorization;
    if (!authToken) {
      throw new Error(exports.MISSING_AUTH_TOKEN_MESSAGE);
    }

    const jwtData = await exports.verifyJwt(authToken);
    const user = await exports.getUser(jwtData.sub);
    const activeCustomer = user.customers.find(c => c.id == user.active.customerId);
    const rolePolicies = await exports.getRolePolicies(activeCustomer.roles);
    const consolidatedRolePolicies = exports.consolidateRolePolicies(rolePolicies);

    const policy = exports.buildPolicy(user, consolidatedRolePolicies);

    return policy;
  } catch (err) {
    console.error(err, err.stack);
    context.fail('Unauthorized');
    return null;
  }
};

exports.buildPolicy = (user, rolePolicies) => {
  const policy = {
    principalId: user.pk,
    policyDocument: {
      Version: '2012-10-17',
      Statement: []
    },
    context: exports.generateRequestContext(user)
  };

  if (rolePolicies.allowedPaths?.length) {
    policy.policyDocument.Statement.push(
      {
        Action: 'execute-api:Invoke',
        Effect: 'Allow',
        Resource: rolePolicies.allowedPaths
      });
  }

  if (rolePolicies.deniedPaths?.length) {
    policy.policyDocument.Statement.push({
      Action: 'execute-api:Invoke',
      Effect: 'Deny',
      Resource: rolePolicies.deniedPaths
    });
  }

  return policy;
};

exports.generateRequestContext = (user) => {
  return {
    userId: user.pk,
    customerId: user.active.customerId,
    email: user.email,
    roles: JSON.stringify(user.customers.find(c => c.id == user.active.customerId).roles),
    ...user.details?.firstName && { firstName: user.details.firstName },
    ...user.details?.lastName && { lastName: user.details.lastName },
    ...user.details?.suffix && { suffix: user.details.suffix }
  };
};

exports.verifyJwt = async (authToken) => {
  const signature = await exports.getJwtSignature();
  if (!signature) {
    throw new Error(exports.SIGNATURE_NOT_CONFIGURED);
  }

  const [authType, token] = authToken.split(' ')
  if(authType.toLowerCase() !== 'bearer'){
    throw new Error(exports.NOT_BEARER_TOKEN);
  }

  const decodedJwt = await jwt.verify(token, signature);
  return decodedJwt?.data;
};

exports.getJwtSignature = async () => {
  if (!signature) {
    const response = await secrets.send(new GetSecretValueCommand({ SecretId: process.env.JWT_SIGNATURE_SECRET }));
    if (response?.SecretString) {
      const secret = JSON.parse(response.SecretString);
      signature = secret.signature;
    }
  }

  return signature;
};

exports.getUser = async (userId) => {
  const command = new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: userId,
      sk: 'user#'
    })
  });

  const response = await ddb.send(command);
  if (response?.Item) {
    return unmarshall(response.Item);
  }
};

exports.getRolePolicies = async (roles) => {
  const rolePolicies = [];
  const command = exports.buildGetRolesCommand();
  const result = await ddb.send(command);
  if (result?.Item) {
    const authorizerRecord = unmarshall(result.Item);
    for (const role of roles) {
      const authorizerRole = authorizerRecord.roles.find(r => r.role == role);
      if (authorizerRole) {
        rolePolicies.push(authorizerRole);
      }
    }
  } else {
    console.warn('There is no authorizer role record configured.');
  }

  return rolePolicies;
};

exports.buildGetRolesCommand = () => {
  return new GetItemCommand({
    TableName: process.env.TABLE_NAME,
    Key: marshall({
      pk: 'authorizer',
      sk: 'roles#'
    })
  });
};

exports.consolidateRolePolicies = (roles) => {
  const allowedPaths = [];
  let deniedPaths = [];
  for (const role of roles) {
    if (role.paths?.allow?.length) {
      role.paths.allow.map(resource => {
        if (!allowedPaths.includes(resource)) {
          allowedPaths.push(resource);
        }
      });
    }

    if (role.paths?.deny?.length) {
      role.paths.deny.map(resource => {
        if (!deniedPaths.includes(resource)) {
          deniedPaths.push(resource)
        }
      });
    }
  }

  for (const allowedPath of allowedPaths) {
    const index = deniedPaths.indexOf(allowedPath);
    if (index > -1) {
      deniedPaths.splice(index, 1)
    }
  }

  return { allowedPaths, deniedPaths };
};