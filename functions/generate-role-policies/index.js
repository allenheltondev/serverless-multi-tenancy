const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');

const ddb = new DynamoDBClient();

exports.handler = async (event) => {
  const routes = [
    {
      route: `${process.env.PARK_API}/GET/parks`,
      roles: ['admin', 'visitor', 'member']
    },
    {
      route: `${process.env.PARK_API}/POST/parks`,
      roles: ['admin', 'member']
    },
    {
      route: `${process.env.PARK_API}/POST/parks/*/statuses`,
      roles: ['admin']
    },
    {
      route: `${process.env.PARK_API}/POST/parks/*/webhooks`,
      roles: ['visitor']
    },
    {
      route: `${process.env.USER_API}/PUT/settings`,
      roles: ['admin', 'member', 'visitor']
    },
    {
      route: `${process.env.USER_API}/POST/customers`,
      roles: ['admin', 'member', 'visitor']
    },
    {
      route: `${process.env.USER_API}/GET/customers`,
      roles: ['admin', 'member', 'visitor']
    },
    {
      route: `${process.env.USER_API}/GET/settings`,
      roles: ['admin', 'member', 'visitor']
    },
    {
      route: `${process.env.USER_API}/PUT/customers/*/roles`,
      roles: ['admin', 'member', 'visitor']
    }
  ];

  const roles = exports.transformRoutesToRoles(routes);
  await exports.saveRolePolicies(roles);
};

exports.transformRoutesToRoles = (routes) => {
  const roles = [];
  for (const route of routes) {
    for (const role of route.roles) {
      let existingRole = roles.find(r => r.role == role);
      if (!existingRole) {
        existingRole = {
          role: role,
          paths: {
            allow: [],
            deny: []
          }
        };
        roles.push(existingRole);
      }

      existingRole.paths.allow.push(route.route);
    }
  }
  return roles;
};

exports.saveRolePolicies = async (roles) => {
  const command = new PutItemCommand({
    TableName: process.env.TABLE_NAME,
    Item: marshall({
      pk: 'authorizer',
      sk: 'roles#',
      roles: roles
    })
  });

  await ddb.send(command);
};